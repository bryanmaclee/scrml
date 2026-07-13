# scrml — Session 253 (LIVE — banked mid-session, NOT wrapped) — PA-contract DEDUP landed + Peter onboarded

**Date:** 2026-07-13. **Profile:** A (`/boot`). **Status:** LIVE — commit-lock HELD (S253, lease
16:40Z). Bookkeeping banked mid-session per bryan ("catch up bookkeeping, bank and push, then continue").
NOT a wrap — the session continues; much backlog left + ctx budget healthy.

## ⚠️ READ FIRST
- **S253 is LIVE and holds the commit-lock** (`../scrml-support/handOffs/active-sessions/commit-lock.sh`).
  If you are a successor booting concurrent: I am the leader; partition by write-footprint, defer the wrap.
- **Everything pushed, both repos 0/0.** scrml `45c8dcd6` · scrml-support `ffe5c7b` (+ this bank).
- **The PA-contract DEDUP LANDED** (the S217-deferred grown-form migration). The contract is now
  `pa-base.md` (v2) + `pa-scrml-overlay.md` + `pa-profile-<slug>.md`, read directly from scrml-support.
  **Next boot reads base+overlay, NOT the retired `pa-scrml.md` monolith** (now a tombstone redirect).

## ✅ LANDED + PUSHED THIS SESSION
- **PA-contract dedup** (scrml-support `96469dc`, scrml `45c8dcd6`): `pa-base.md` v1→v2 (+12 universal
  addenda lifted, +4 slots, **0 removed** → giti-safe) · `pa-scrml-overlay.md` NEW (fills all 34 project
  slots + Layer-3 Rules 1/2 + repo content) · `pa-scrml.md` → tombstone (verbatim monolith preserved at
  `scrml-support/archive/pa-scrml-monolith-superseded-2026-07-12.md`) · pointers rewired (`scrml/pa.md`,
  `scrml/.pa-base/profile`, `pa-core-scrml.md`, `pa-profile-{bryan,ryan}.md`). Round-trip §11 verified:
  0 of 34 project slots dangling, 14/14 behavior spot-checks. Plan+mapping:
  `scrml-support/docs/deep-dives/pa-contract-dedup-fold-plan-2026-07-12.md`.
- **Peter onboarded** (scrml-support `ffe5c7b`): `pa-profile-pjoliver11.md` — his per-user layer on
  base v2 (slug matches his git `user.name`=`pjoliver11`). Starter (register/provenance TBD → base
  Rule 5). Two bryan-set guidance points (S252): technical-peer-limited-hand-coding altitude +
  propose-the-rung-readily ladder scaffolding. bryan sent the scrml-support collaborator invite.

## 🧭 THE FOLD DECISIONS (the irreducible narrative)
- **4 forks ruled by bryan "your leans, go":** (1) consumption = **direct-read** (scrml co-located with
  scrml-support → reads base+overlay in place, no vendored copy; giti/6nz vendor because cross-remote);
  (2) base-lift scope = **inclusive** (do the 12 base-v2 lifts now, re-vendor giti — queued to master);
  (3) precedent narratives = **pointer-not-cut** (they live in changelog/delta-log/memory; overlay
  points, doesn't duplicate); (4) `pa-core-scrml.md` reconciliation = **deferred** (FORK 5).
- **Tombstone-not-hard-move** (a PA call): grep found ~40 live authority-pointers into `pa-scrml.md`
  (all 4 satellites + pa-core + 30+ historical deep-dives). A hard move strands them → kept the path as
  a superseded redirect; full monolith archived. Deliberate softening of "`superseded`→deref-to-archive"
  for a heavily-cited file (the tombstone IS the mark; content is archived).
- **The fold was smaller than S252 framed:** `pa-base v1` already carried ~90% of the monolith's doctrine
  (it was distilled from it 2026-06-11). The real work was extract-fills-to-overlay + forward-port the
  12 post-June-11 universal addenda. Base's §3 deliberation ladder had grown PAST the monolith — that
  drift was the whole reason to fold.

## 📋 OPEN THREADS
- **giti re-vendor (base v2)** — queued to master inbox (`scrmlMaster/handOffs/incoming/...revendor-giti.md`;
  filesystem dropbox, not a repo). A master/giti-PA action; +4 new slots for giti's overlay to fill/mark.
  **6nz is un-migrated** (monolithic pa.md, design-phase) — separate future migration.
- **FORK 5 (deferred)** — reconcile `pa-core-scrml.md`'s condensed *content* to base+overlay. It's a
  valid Profile-B read now (authority pointer fixed), just still carries pre-fold prose. Low priority.
- **Peter** — human actions owed by Peter: accept invite, fork scrml, clone scrml-support as sibling, `/boot`.
- **Awaiting bryan (parked from S252):** fail-arity code mint (`g-fail-variant-payload-arity`;
  recommended a general E-TYPE-082-style code over error-specific) · Fork 3 (flogence MCP stdio — v1
  tandem-gate or fast-follow?).
- **Freeze-coverage residuals (MED):** real-DB conformance adapter · ss66's 13 SPEC-vs-compiler emission
  gaps (Rule-4 triage: unbuilt-Nominal or SPEC-over-claim?) · class-attr-interp DG-002 bug.
- **S251 buildable backlog** (`docs/pre-v1-execution-board-2026-07-12.md`): Cask-0 · protect-denylist ·
  typer Option-D equality-half (post-freeze) · §65 W2.

## 🚦 STATE @ BANK
- git: scrml `45c8dcd6` + this bank (hand-off rotate + delta-log); scrml-support `ffe5c7b` + this bank
  (board housekeeping). Both push at this bank → verify 0/0. commit-lock HELD (S253). No live sibling.
- **No compiler/language change this session** → conformance unchanged (427/427); changelog unchanged
  (PA-infrastructure only, not adopter-facing); master-list §0 unchanged; maps unchanged.
- Board: S249/S250/S251/S252 archived → `active-sessions/read/` (all wrapped per the ledger; S251's
  header falsely still said LIVE); only S253.md live.
- Delta-log: S253 entries `[483]-[486]` appended. NB the delta-log had a gap — S251/S252 did not append
  (last was `[482]` S250 WRAP); not backfilled (their granular stream is unrecoverable).

## pa.md directives in force (now base v2 + overlay)
R1-R5 · S239 adversarial-review · S138 R26 · commit-lock (trust-tool) · commit/push after authz ·
orchestrate-don't-grind + default-GO · the deliberation ladder.

## Tags
#session-253 #pa-contract-dedup-LANDED #pa-base-v2 #pa-scrml-overlay #tombstone #peter-onboarded
#pjoliver11 #banked-mid-session #live-holds-lock #fold-smaller-than-framed
