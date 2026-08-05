# Wide-corpus emit-differential harness — build the tool, then run it on U1

**Dispatched S322-bryan 2026-08-05.** Authority: bryan, this session — *"go, build the harness"*.
Origin: the U1 arc's own progress log names this as the landing gate
(`docs/changes/u1-emitcall-client-serverfn-await/progress.md`, "Recorded, deliberately NOT fixed"):

> **Wide-corpus harness** (`examples/**` + `samples/**` + `conformance/**`) — NOT done.
> The 708-bundle corpus is too narrow and WILL hand you a false green: it contains zero
> `setTimeout(`, and zero instances of every shape in rounds 2-3.

## Why this is a repo tool and not another per-arc script

**The same defect has now shipped three times, each time in a throwaway harness, each time
leaving a gate that reported green while measuring a fraction of its population.**

| # | harness | the corpus bug | consequence |
|---|---|---|---|
| 1 | `artifact-diff.mjs` (S282, chunk-namespacing) | `walk()` recursed but pushed `relative(root, p)` against the SUB directory | **compared 8 of 115 files**; recorded at `docs/changes/chunk-namespacing/S282-REVIEW-FINDINGS.md:105-106` |
| 2 | `scripts/u1-corpus-emit.sh` (S319, in the U1 worktree) | globbed `examples/*.scrml` + `samples/compilation-tests/*.scrml` — **top-level only, two directories** | measured **329 of 1818** sources; reported 708/708 byte-identical |
| 3 | the same script, `node --check` half | inherited the same population | reported base 2 / head 2; an independent reviewer over the wide corpus got base **44** → head **46** |

`pa-base v2.13 §8` calls this **the truncated probe**: *"a truncated enumeration reads exactly like a
complete one. There is no error, the output is well-formed, and every downstream count, ratio and
scoping decision inherits the truncation."* The two defenses it prescribes are the two hard
requirements below.

## Deliverable A — `scripts/corpus-emit-differential.ts`

A general, reusable harness. Not U1-specific; U1 is its first consumer.

**Two modes:**

1. **capture** — enumerate the corpus, compile every source with a NAMED compiler root into a
   per-source output dir, and write a machine-readable manifest (source list, per-source compile
   outcome, every emitted artifact with a content hash, `node --check` outcome per artifact).
2. **diff** — take two manifests and report: sources enumerated on each side · compile-outcome SET
   difference (not counts — the actual added/removed file lists) · every artifact whose content hash
   differs, with its source · the `node --check` failure SET on each side and the delta.

### HARD REQUIREMENTS (each one exists because its absence shipped a false green)

1. **Self-reported totals, `N of M`, at every stage.** Enumerated, attempted, compiled, emitted,
   checked, diffed. A number that is a subset of another number must say so in the output. This is
   the defense that makes a truncation *visible in the output* rather than *inferable from it*.
2. **No silent caps anywhere.** No `head`, no `.slice()`, no pagination, no default result limit, no
   "first N differences". If the tool ever deliberately bounds output, it must print what it dropped
   and the count. A bounded *display* is fine; a bounded *measurement* is not.
3. **Recursive enumeration, and the roots are arguments, not constants.** Default roots
   `examples/`, `samples/`, `conformance/`. Verified current counts: **71 · 877 · 870 = 1818**
   (`find <root> -name '*.scrml'`). The narrow script's 329 is what happens when the roots are
   hardcoded top-level globs.
4. **Cross-check the enumeration against an independent count** and fail loud if they disagree —
   the walk must not be its own oracle (that is precisely how defect #1 survived).
5. **Compile failures are DATA, not a stop.** ~17 of the corpus are negative fixtures that must fail.
   The signal is the failure SET changing, never the failure count being nonzero.
6. **`node --check` runs on BOTH sides and reports the DELTA.** A head-only count cannot distinguish
   "clean" from "clean because we didn't look at the files that break."
7. **Determinism.** Stable ordering, content hashes not timestamps, no wall-clock in the manifest.
   Two capture runs over an unchanged tree must produce identical manifests — please verify this,
   it is cheap and it is the property the whole diff rests on.

### PROVE THE BITE (mandatory — `pa-base §8`, "the unproven gate")

A gate that has never failed is indistinguishable from one that cannot fail. Before reporting:

- **Artifact diff bites:** perturb one emitted artifact in a captured tree → diff reports exactly
  that file → restore → clean.
- **`node --check` bites:** corrupt one emitted bundle's syntax → the check reports it on that side
  and the delta is non-zero → restore → clean.
- **Enumeration bites:** point a run at a root with a known file count and confirm the reported `M`
  matches; then confirm a deliberately-narrowed root reports the SMALLER number **loudly** rather
  than silently succeeding.

Record all three in `progress.md` with the actual command and output. A bite you did not run is a
bite that did not happen.

## Deliverable B — run it on U1 and answer the question

**Base `20a15c15`** (the U1 branch's own base) vs **head `09e4d08c`** (branch
`worktree-agent-a9c144ab82648e947`, tip — five defects fixed across rounds 2-3, never re-verified
wide).

Do NOT mutate the U1 worktree at `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a9c144ab82648e947`
— it is a live, unlanded artifact and it is the only copy of that work. Provision your own
read-only checkouts (`git worktree add` from your own workspace) for both revisions.

**Report, per the two-sided doctrine:**

- Sources enumerated (expect ~1818 — if you get 329, the tool is wrong).
- Artifacts emitted per side, and every artifact that DIFFERS, grouped by source, each with a
  one-line reading of *why* (this is a behaviour change vs this is noise).
- Compile-failure SET delta.
- `node --check` failure SET on each side and the delta. **The reviewer's independent measurement
  was base 44 → head 46. If you reproduce a head-side increase, those two bundles are the story of
  this dispatch** — identify them, identify their sources, and determine whether they are stranded
  awaits (a whole-bundle SyntaxError is U1's dominant risk per its brief) or pre-existing garbage
  downstream of an already-failing compile.
- An explicit statement of whether U1's round-2/3 state is wide-corpus clean. **You are not being
  asked to make U1 land.** A clear "no, and here is what breaks" is a fully successful dispatch.

## Verified vs hypothesis — read the labels

**VERIFIED by execution this session** (trust these):
- Corpus counts 71 / 877 / 870 = 1818; the narrow glob's population is 32 + 297 = 329.
- Compile CLI: `bun compiler/src/cli.js compile <src> -o <outdir>` — works, ~0.4s/file.
- `scripts/` contains no existing wide-corpus or artifact-diff harness (full listing inspected).
- The narrow script's full text is at
  `.claude/worktrees/agent-a9c144ab82648e947/scripts/u1-corpus-emit.sh` — read it, it is 40 lines
  and it is the thing you are replacing.

**PA-LOCATED-VERIFY** (hypotheses — confirm, refine, or report wrong; do not treat as fact):
- `artifact-diff.mjs` is referenced in the S282 findings but I did **not** locate the file; it may
  be deleted. If it survives, decide whether to fold it in or supersede it, and say which.
- I have not traced how `conformance/` cases compile — 870 files is the largest single root and some
  may be fragments rather than compilable programs. **If a root needs different handling, that is a
  finding, not a reason to drop it.** Report the shape; do not silently narrow the corpus, which is
  the exact defect this tool exists to kill.
- Runtime: 1818 × 2 ≈ 3600 compiles at ~0.4s ≈ 24 min serial. A worker pool is expected. If wall
  time exceeds ~20 min per side after pooling, report it — do not sample.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its Task-Shape Routing for this task shape
(tooling / build / test-infrastructure). Stamp: `updated 2026-08-05, commit 15e5e070`. Main is
`f5d970a7` — ONE docs-only commit ahead (#421, S321-peter's wrap continuity), so the map is current
for all source purposes. Treat map content as a verify-against-source hypothesis. **Report whether
the maps were load-bearing for this task — "not load-bearing" is a valid and useful answer.**

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

1. First action: `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Confirm `git rev-parse --show-toplevel` equals it and the tree is clean. If ANY check fails,
   **STOP and report** — do not proceed.
2. `bun install` (a fresh worktree does NOT inherit `node_modules`; the hook fails on missing `acorn`
   otherwise). Then `bun run pretest` (populates gitignored browser fixtures).
3. Every Read/Write/Edit uses an **absolute path under your worktree root**. A relative path resolves
   against the main checkout via the additional-working-directories list and leaks.
4. **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`,
   and worktree-absolute paths only. A sibling `cd` persists and silently makes every later command
   answer about the wrong repository.
5. Echo the startup pwd in your first commit message (`WIP(harness): start at <pwd>`).

## CRASH RECOVERY

Commit after each meaningful unit — WIP commits are expected and wanted; the branch is the
checkpoint. Keep an append-only, timestamped `progress.md` in
`docs/changes/u1-wide-corpus-harness/`. The branch plus that log are the recovery anchor: if you
die, they are all the next agent gets. Never leave work uncommitted at a stopping point.

## Constraints

- **Do not modify any compiler source.** This dispatch builds a measurement tool and runs it. If the
  measurement says U1 is broken, that is the deliverable — **do not fix U1**.
- **Do not bypass the commit gate** (`--no-verify`) under any circumstances without coming back for
  authorization. Batch commits if the hook is slow.
- If the task turns out materially larger than scoped, **STOP and report** rather than widening.
