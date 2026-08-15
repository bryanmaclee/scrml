<!-- ============================================================= -->
<!-- hand-off.md — live session state. ROTATED at S345-bryan:      -->
<!-- prior wrap handOffs/hand-off-s343-bryan.md (S343-bryan).      -->
<!-- Mechanical stream: handOffs/delta-log.md [1473]-[1492].       -->
<!-- ============================================================= -->

# scrml — Session 345 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-08-14/15. `/boot` Profile A, solo (S343 + S344 both WRAPPED at boot).
**All four of S343's held items RULED and executed. Nine PRs merged.** The session was
dominated by an unplanned arc: **the cloud gate was down repo-wide, it was never a flake, and
fixing it exposed four more defects — one of them adopter-facing.**

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### The ONE thing the operator deferred

**dtr ROUND 6 — scoped, briefed in substance below, NOT dispatched.** Operator: *"we better
handle round six next session."* Round 5 is built + frozen (`review/derived-transitive-r5` =
`bf99a93a`, branch `dtr-r5` on origin) and reviewed → **DO-NOT-LAND, 7 blockers**. Round 6's
work order is the review output at
`/tmp/.../d127780a-.../tasks/wbbw9uw2w.output` (**tmp — re-derive if gone**; the frozen tree
and both review runs are reproducible from the tag).

**Round 6 must fix, in priority order:**
1. **★ A REAL SILENT MISS (HIGH, new):** a hop caller's **PARAMETER DEFAULT** is never scanned —
   `function wrap(x = doHash(@pw))` → exit 0, async stub bound into the derived recompute,
   `[object Promise]` rendered. **Rounds 1-5 all missed this position.**
2. **★★★ THE STANDING CONSTRAINT — stop writing codegen-agreement claims IN ANY FORM.** Three
   rounds, same defect class: r3 *"already refused via 5b"* · r4 *"suppression and emission agree"*
   · r5 *"codegen renames EVERY reference"*. Each generalised a **universal** about codegen from a
   **measured subset**. Falsified on r5's own enumerated class: the mangler's lookahead
   `(?=\s*[(;,}\]\n)]|$)` means a shadowed name in **operator position** (`doHash + 1`) is renamed
   nowhere, so RI refuses a program codegen compiles correctly and synchronously. **The true
   statement is the arc's own test wording — *"every shape codegen would rewrite is refused at
   compile time"* — a one-directional CONTAINMENT claim. RI is a strict SUPERSET of codegen's
   rewrite set, never equal to it.** Write only containment; never equality.
3. Propagation misses: the mandate-4 provenance fix landed at `SPEC.md:3700` but NOT at the §6.6
   catalog row `SPEC.md:3304`, which still cites S345 for shadow semantics (which :3700 forbids)
   and miscounts the residuals.
4. The new `hop-param` **"control" test is named *clean* but never asserts clean** — it stays green
   while its own subject program is refused.
5. The new DIRECT-limb residual (`SPEC.md:3729`) misdescribes what §6.6.19 closes.

**Then re-review round 6** (the workflow script is reusable — see §INSTRUMENTS).

### Owed to the operator (decisions, not work)

- **Nothing is blocking.** All four S343 items are closed. Round 6 is authorized in principle
  ("next session"), so it can be dispatched at boot without a new ruling.

## 🔧 THE FOUR RULINGS (banked verbatim in `../scrml-support/user-voice-scrml.md` S345)

| Q | ruling | executed |
|---|---|---|
| **Q1** Gap 5 sequencing trap | **(c)** — the F3 §6.6.19 rewrite lands **DESCRIPTIVE of current impl, NOT a ratification**; main's pre-arc sentence stays the governing design intent; lexical scoping QUEUED | provenance note landed in r4/r5; **refinement discovered by the build:** the queued arc must move the reference scanner **AND codegen's renamer together**, or it reopens the miscompile |
| **Q2** the unfiled entries | **file the 40, hold the 12** | **PR #525 MERGED** — 40 entries + 2 re-characterisations |
| **Q3** five zero-byte objects | **(a) delete**, dry-run + fsck bracketed | done: **fsck 7 → 1**, salvage verified intact |
| **Q4** derived-transitive merge | blocked on a real review | r4 + r5 both DO-NOT-LAND; **round 6 deferred by the operator** |

## 🚨 THE GATE OUTAGE — five defects in one causal chain

Each was invisible until the previous one stopped masking it. **Every red was a real defect, and
none was in the code under review** — re-running or `--write`-ing the baseline would have buried
four of them.

| # | PR | defect |
|---|---|---|
| 1 | **#526** | stale cross-file `DOMContentLoaded` `_scrml_boot` listeners on the shared happy-dom document; the 20260810 runner image only reshuffled bun's readdir file order (writer pos 660 now before victim 719). **The mixed-pool rollout ~Aug 10 IS the entire S338-S343 "flake" era.** Fix `{once:true}` — production-identical; **bite-proven ON the red image** |
| 2 | **#527** | the flagship test's unsorted app walk (compile order of its own inputs) |
| 3 | **#528** | ⭐ **THE COMPILER'S OWN WALKS.** `scrml compile <dir>` emitted **order-dependent output**: reversing inputs changed **79 files including GENERATED SERVER ROUTE URLs** (`__ri_route__sessionStore_1` → `_63`). Two machines can build a client and server that disagree about where to fetch; §47 content-addressing + §58 build-story determinism are stated properties this broke. INERT here (fs order already sorted) |
| 4 | **#529 [DRAFT]** | the gate driver handed bun a bare DIRECTORY → tier order = readdir order, under a gate asserting an exact NAME SET, over a tier sharing ONE document. **HELD: correct, but its determinism currently resolves RED** — landing it converts an intermittent into a permanent main-red. Sequence: make `flagship-hos` hermetic first |
| 5 | **#530** | todomvc picked its runtime by first-readdir from a dir holding **15** accumulated runtimes. Verifier correctly NARROWED it: mechanism confirmed, outcomes refuted (36 pass either way) ⇒ **illusory coverage, not wrong results** |

## 📌 THE RESIDUAL — `flagship-hos` intermittent (characterized, NOT closed)

Do not re-derive this; three sessions already have.
- **Intermittent, cloud-only.** Same SHA passes and fails. **NOT tied to a commit** (dispatch on
  `7e4a86aa` passed, on `a946fc32` failed, on the diag branch passed) and **NOT tied to event type**
  — both hypotheses were mine, both plausible, both **retired by measurement**. **#528 was suspected
  and is EXONERATED** by timeline (#525 failed on it 08-14, before #528 existed) and by mechanism
  (`scanDirectory` is CLI-only; `compileScrml` never calls it).
- **The compile SUCCEEDS** (proven by #531's loud-fail assertion). The emitted HTML simply lacks a
  `<template>` containing `data-scrml-engine-mount`.
- **#531 fixed two real defects inside it**: a fixed `/tmp` path any concurrent reader could catch
  mid-delete, and a failure mode that named nothing.
- **Instrumentation is committed** on `diag/flagship-hos-template` (never merges) — including a
  **direct-run `bun test <file>` CI step, which is REQUIRED**: `browser-baseline.ts` runs the tier
  via `spawnSync` with `encoding:"utf8"` and **CAPTURES stdout**, so `console.log` inside a test is
  swallowed. My first diag round returned nothing for exactly that reason.
- **⚑ Do NOT `--write` the baseline.** The gate's own message invites it; it would green everything
  in one command and permanently blind a test guarding a real engine-under-`if=` defect.
- Open hypothesis: cross-file coupling through the shared document (27 files register behind a
  first-file-wins guard; 71 unregister).

## ⚙️ INSTRUMENTS BUILT THIS SESSION (reusable)

- **The review-workflow COVERAGE GUARD.** A review workflow SHALL derive its verdict from
  **completed-agent count**, never findings count. `agents_done < agents_launched` ⇒
  **INCONCLUSIVE**, never CLEAN. Second guard added after: findings whose verifiers BOTH died are
  surfaced as **unverified**, not silently counted as refuted. Scripts:
  `.../workflows/scripts/s239-dtr-r5-review-*.js` (5-lens) and `...-r4-review-v2-*.js` (6-lens).
- **CI: `push` scoped to `main`** (#532) — every PR ran the gate TWICE (branch push + PR), both
  under the required name `gate`, doubling exposure to any intermittent AND creating the
  "push fails / pull_request passes" phantom that cost real diagnostic time. **Bite-proven: its own
  PR produced ONE gate run, not two.**
- **Order-dependency sweep**: 141 sites, 4 partitions, 131 inert, 10 hazards, 5 confirmed.
  **Still open + unfixed:** `validate-emit-gate.test.js:33` · `parser-conformance-collect-hoisted.test.js:592`
  (an index-strided sample selecting WHICH files get tested) · `render-corpus-enumerator.js:214`
  (picks a multi-file app's ENTRY file by first-match).

## ⚠️ MISSES + FRICTION (mine, recorded because they will recur)

1. **★★★ MY OWN REVIEW HARNESS REPORTED A FALSE GREEN.** The dtr-r4 review returned
   **"CLEAN-TO-LAND" from ZERO completed agents** — all 6 lenses died on a rate limit, and my
   post-processing computed `blockers.length === 0 → CLEAN`. The hollow gate, self-inflicted, in a
   gate I wrote the same session. Landing on it would have shipped an unreviewed codegen change.
   → memory `feedback_review_workflow_verdict_from_agent_count`.
2. **Three blind probes**, all caught by reading output rather than exit codes: an artifact
   "no diff" that was an EMPTY baseline dir; a `gh pr checks --json` flag that does not exist in
   this CLI version (whose loop then read "no checks" as "done"); and diagnostic `console.log`s
   swallowed by the harness being instrumented.
3. **Two wrong attributions, both mine, both retired by measurement** — suspecting my own #528 of
   reddening main, and reading the push/PR split as an event-type cause.
4. **PATH-DISCIPLINE INCIDENT:** three reproducer `.scrml` files written by a review agent to the
   **main checkout root** instead of scratch. Caught at wrap step 6; zero tracked-file damage;
   preserved + removed. The hook covers Edit/Write on worktree paths, not an agent writing a
   relative path from the shared root.
5. **A round-5 agent corrected my brief and was right** — I asserted the r3 alias blockers were
   "confirmed FIXED"; the work order files them as documented-not-closed.

## 🧷 STATE / DEFERRED

- **Open PRs:** **#532** (CI change — merge when a gate leg goes green; it is correct and
  bite-proven) · **#529 [DRAFT]** (hold per above) · **#501 `tare`** (pre-existing chain, untouched
  this session).
- **Owed filings** (drafted at `/tmp/.../scratchpad/owed-filings.md`, re-derive if gone):
  (a) `g-logic-placeholder-ids-not-chunk-namespaced` — MED, adopter surface: SPA soft-nav
  route-chunk injection can cross-write another chunk's spans; `{once:true}` does NOT close it.
  (b) the DIRECT-limb leak — **now SETTLED by the r4 review** (upgrade from my RELAYED-NOT-VERIFIED
  draft) and **sharpened by round 5: it is NOT shadow-specific** — root cause is
  `prune-server-only-stdlib-chunks` (`emit-client.ts:2898-2945`) keeping a chunk on any
  word-boundary **TEXTUAL** occurrence; route inference is never consulted, so a plain string
  literal mentioning `hashPassword` leaks identically. (c) **§12.2 Trigger 3 has the identical
  body-only blind spot** — a server-only stdlib import in a **parameter default** ships argon2id.
  (d) `§14.12.6.1 ↔ §18.8.2` tension: the `match` presence-discrimination escape hatch is
  unreachable by construction for `(not to SomeStruct)` (`E-TYPE-024` refuses match over a struct) —
  a RULING, → dpa-queue.
- **Worktrees: retained.** S343's do-not-prune stands (six unlanded arcs + two dead-session HIGH
  fix rounds); this session added the r4/r5 agent worktrees and two frozen review checkouts.
- **Maps:** stamp unchanged; the session's code landings are test/CI/`api.js`-scoped. Refresh owed.
- **Review floor:** #523 carve-out filed; the nine PRs merged this session are **owed reviews** —
  the S239 passes ran on the dtr arc, not on the gate-fix PRs (each was PA-verified by execution
  instead: artifact diffs, bite proofs on the red image, local tier runs).
