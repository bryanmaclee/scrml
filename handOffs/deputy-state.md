# scrml — deputy state (re-hydration anchor)

**Created S203 (2026-06-17).** The vPA deputy's durable re-hydration anchor — the small file the
deputy re-boots off when its transcript grows (cheap + lossless because the deputy does projection,
not deliberation; see `scrml-support/vpa-scrml.md` §"Re-hydration"). **Deputy-owned** (write-surface
partition); the deputy maintains it on the `deputy-maint` branch. The PA reads it but does not edit it.

---

## Deputy status

- **State:** LIVE — steady-state (S205 active). First deputy instance, booted S203. On tick 29.
- **Self-poke loop:** `/loop 30m` — cron job `39fed15c`, `7,37 * * * *`. CronDelete `39fed15c` to cancel.
- **Last-absorbed delta seq:** S205 **[10]** (`scrml/handOffs/delta-log.md` — absorbed [S199 1] … [S205 6]).
- **`deputy-maint` branch:** worktree `/home/bryan-maclee/scrmlMaster/scrml-deputy-maint`. Descends main `0d448fec` (PA integrated ticks 12-15 via the pre-push merge gate). **Tip:** `git rev-parse deputy-maint` (tick-26: digest regen + this).
- **Owed maintenance:** none.

## ✅ The merge-before-push pattern is RESOLVED (contract-level, S205 [2])

The recurring 2× strand (S203 digest-miss + S204 maps-miss) is **structurally closed**: the PA **ratified a HARD pre-push merge gate** into `pa-scrml.md` S199 addendum + wrap **step 7** — assert `git rev-list --count deputy-maint ^main == 0` before any push, else the session ships without the deputy's maintenance. The tick-13 recommendation was adopted verbatim. **GATE FIRED in practice (tick 26): `f07f8406 "Merge deputy-maint (pre-push integration)"` — the PA ran the pre-push merge before pushing S205 [7-9]; the deputy work no longer strands.** **Evidence it works:** the **S205 cold boot read a CURRENT digest** (first clean digest boot — S204 booted stale) **→ thin-start REALIZED** (master-list §0 skipped), and the S204 maps-owed thread resolved at boot (deputy-maint FF-merged → maps `cc765a5a` picked up). The deputy F1 function now delivers as designed when the gate holds.

## F1 dilation — REALIZED + confirmed (S205 [3])

The clean-cycle re-measure (the S204 [6] follow-up) ran: digest booted current → **F1 realized ~8.3k** (master-list §0's 9,364 tok skipped − 1,035 tok thin path), confirming+exceeding the S204 7-8k projection (which realized **0** in S204 because the digest booted stale). F2 ~6-7k (deputy maps+regens FF-merged at boot). Total ~14-15k/cycle ≈ 1.5%/1M — the S204 band HOLDS, F1 now realized. (vpa-deputy DD §S205-remeasurement.)

## Flogeance components building (PA work — observed, not deputy surface)

- **dock** (`scripts/dock.ts`) — the adopted agentic-code-provenance dock checker, thin-built S205 ([4], `40590c73`); slices 1-2 ([6], `686dc795`) = coverage walker over scrml `.scrml` defs (`// #dock[…]`). REAL baseline: **628 reasoning-units / 120 files / 0% docked** (greenfield). Rides flograph.
- **flograph** slice 4 ([5], `7d53119f`) — cites/derivation layer + `--derivation` traversal. (Earlier: `--mmd`/`--filter`/`--focus` + slices 1-3 supersession/currency.)
- The S204 update message to flogeance's inbox (baton-retired/deputy/dilation/flograph/dock) was delivered 2026-06-18 (flogeance `e5c3991`, local — no remote).

## Graph/dock health (§3c — recorded per tick, S205 [10] standing step)

- **Snapshot @ tick 27 (PASS):** flograph 428n/103e (--with-support --with-archive) · currency-sweep **0 (clean)** · provenance/unverified 14 · dangling 15 · 0 dup · 0 err. dock --check PASS (0 malformed/dangling/superseded · 1 unverified info). dock --coverage 0/628 (0.0%) · 0 orphans.
- **vs [10] baseline (426n/96e · curr-sweep 0 · prov 7 · dock PASS · cov 0%):** curr-sweep still 0 ✓, dock PASS ✓, cov 0% ✓; node/edge + unverified grew (new [9] harness-validation capstone + block-lease DD cites = asserted-not-verified, benign). **No NEW actionable finding** (no new currency-sweep hit · no dock ERROR · dangling decided-by/cites are standing-or-PA-authored · no dup-id).
- **route to PA (tooling nit, once):** §3 says plain `bun scripts/flograph.ts --emit` but §3c checks `--with-support --with-archive` → following §3 literally leaves graph.json at the default 190n corpus, so the 3c check ALWAYS reports a stale/drift ERROR. The deputy compensates by emitting `--with-support --with-archive`. Align §3 emit flags with the §3c check flags (or make --check corpus-aware) so the standing guardrail is green without the deputy working around it.

## In-flight dispatches (F3 watch list)

- **`a3a475168766ceba8`** — trucking slice-3 each-sweep (for/lift→each across examples/23-trucking-dispatch). **Status @ tick 29:** worktree present (locked); 3 WIP commits (customer/home + loads done, invoices left Tier-0) + dirty (load-detail.scrml + progress.md) → in-flight; surfaced a compiler bug (BUG-1 nested-quote ternary in per-item each attr). **PA ALIVE** (uncommitted hand-off + change-dir in main) → PA owns the landing; no `(deputy)` entry. Watching. NOTE: edits `.scrml` corpus → a maps refresh may be owed once it lands (assess then).
- ~~`af88c53a`~~ landed (#3); ~~`abcf64f7`~~ closed tick 5.

## Tick log (compressed)

T1 boot [S199-S203]; T2-T3 F1 LIVE + GO-LIVE; T4-T5 e2e/flograph; **T6-T8 reboot-gap** (#3 in-flight bridged → fresh PA re-attached + LANDED); **T9-T11** S204 [1-6] (#3 landed, flograph slices, dilation ~3% frame-fix); **T12** maps REFRESHED (60d547e1→cc765a5a, user ruling); **T13** 2nd merge-before-push miss flagged; **T14** PA caught up; **T15** absorbed S205 [1-6] — merge-before-push gate RATIFIED + F1 realized ~8.3k + dock built; digest regen. **LESSON (T15):** the source-based digest oracle CAUGHT an absorb-miss (pre-rebase delta-log read showed [8], missed the S205 block) → **always re-check the delta-log AFTER sync/rebase, not before.** **T16-25** PA idle — 10 consecutive no-op ticks (held surface current, no commits). **T26** PA resumed: absorbed S205 [7] corpus-hygiene deref (48 superseded DDs→archive/) + [8] flograph --with-archive provenance tier + [9] flogeance harness-validation capstone; gate fired (f07f8406); digest regen. **T16-25** PA idle (no-ops). Wait — T26 already covered. **T27** absorbed [10] (§3c guardrail wired); ran first health check: flograph PASS (curr-sweep 0), dock PASS, cov 0%; drift self-fixed (re-emit --with-support --with-archive); 1 tooling-nit routed (§3/§3c emit-flag mismatch); digest regen. **T28** no-op (main static; §3c green; discarded a no-op digest stamp-bump). **T29** NEW in-flight agent a3a475168766ceba8 (trucking slice-3 each-sweep) → F3 watch (PA alive, no entry); main static, digest current, §3c unchanged.

## Currency snapshot (@ tick 15)

- **Board:** HIGH 0 · MED 11 · LOW 23 · Nominal 8 (S204 wrap: MED 12→11).
- **maps:** watermark `cc765a5a` — CURRENT for compiler-source (no compiler-source since; S205 work is all `scripts/` tooling — dock/flograph/state). In main (origin) since the S205 boot integration.
- **digest:** current (head `e14462a6`, delta-seq S205 [10]).
- **recent-sessions / gap-counts:** PASS.
- **flograph/dock:** building (see above) — `scripts/flograph.ts` + `scripts/dock.ts`.

## Function 3 — agent monitoring (LIVE)

Each tick: `ls .claude/worktrees/` + `git -C <agent-wt> log/status`; scan delta-log for `disp` without `land`/`find`-close. **Append a `(deputy) state` delta-log entry ONLY when** an agent COMPLETED **and the PA is absent/rebooting** (narrow single-writer exception — observation-only). NEVER land (PA S67 file-delta). Poll git-state.

## Sync rule (each tick)

`git merge --ff-only main`; if NOT clean FF → `git rebase main` (clean on the disjoint surface; a real conflict = partition breach to surface). **Re-check the delta-log + run `state.ts --check`/digest-oracle AFTER syncing** (a pre-sync read can miss new entries — T15 lesson; the oracle is the backstop). Main may move/push mid-tick.

## Operational notes (for re-hydration)

- **node_modules:** fresh worktree has NONE → symlink main's in (survives FF+rebase): `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` · `ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`
- **CWD slip:** Bash CWD resets to MAIN — `cd` the worktree (or `git -C`) before worktree ops.
- **Untracked new file:** `git add` before commit; tracked modifications commit by plain pathspec.
- **Maps refresh:** project-mapper into the worktree (CWD-pinned, worktree-only brief) + `git -C <main> status` clean-verify before committing (resolved T12; user ruled no-consent-needed).
- **Commit gate:** pre-commit WARNS on non-main; runs ~17k subset (~75-120s); deputy commits derived-only → pass; never `--no-verify`. `git rebase` does NOT run the gate.

## Maintenance seams (Function 2)

- `.claude/maps/*` — `project-mapper` into the worktree; watermark `.claude/maps/primary.map.md` (`cc765a5a`).
- `docs/changelog.md` — session block. · `@generated` §0 rollup (`docs/known-gaps.md`) + `master-list.md` §0.6 — `bun scripts/state.ts --write` (gate `--check`).
- `handOffs/digest.md` — `bun scripts/state.ts --digest` (F1; per tick when a projected source moved — known-gaps/delta-log/maps/version).
- flograph — `scripts/flograph.ts`. · dock checker — `scripts/dock.ts` (PA-built; deputy observes). · block-lease registry — (not built yet).

## Cross-refs

- `scrml-support/vpa-scrml.md` — deputy contract. · `scrml-support/pa-scrml.md` §"S199 addendum" — PA-side contract (now incl. the merge-before-push gate + wrap step 7).
- `handOffs/delta-log.md` — the live PA-state stream. · `scrml-support/docs/deep-dives/vpa-deputy-reframe-2026-06-17.md` — design (+ S204/S205 measurement addenda).
