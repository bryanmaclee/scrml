# BRIEF — dpa-034: re-ground the no-editions decision (prose + provenance only)

**Dispatched:** S353-bryan, 2026-08-19. **Ruling:** user-voice-scrml.md S353, bryan *"your rec on all three"*.
**Change-id:** `dpa-034-editions-reground-2026-08-19`. **NOTHING BUILT CHANGES — this is prose + provenance.**

## What was ratified

The conclusion — **no Rust-style editions** — STANDS. What changes is its REASON, for the third time.
Five parts, all ratified:

1. **Reframe §62.8** from a permanent structural declination to **"no editions in the 1.0 surface as
   built."** Round 2 verified §62.8 contains no literal *"EVER"* — the strike lands on its actual
   population premise, the sentence *"Rust's edition-coexistence price … buys 'never split a global
   ecosystem' — worth it for a global ecosystem, not warranted here."*
2. **Strike the population premise from D1 AND D4** in
   `docs/changes/language-version-and-deprecation-lifecycle-2026-07-01/RULING.md`. It is the reasoning
   ruled INADMISSIBLE at S346 (corpus-zero / ecosystem-size is blast-radius evidence only).
3. **Re-ground D1 on suite-singularity + the interaction-matrix.** (a) the BUILT, pre-commit-gated
   conformance suite operationally IS the spec, defining conformance as ONE predicate — editions force
   it parameterized; (b) N rule-sets = N languages that compiler, checker, formatter and LSP carry
   forever. Both are population-INDEPENDENT, which is the whole point.
4. **Record the reopening condition:** *is this a front-end-only delta?* Rust shipped 1.0 in 2015 and
   added editions in 2018 — rustc carries a bounded FRONT-END delta never allowed to fork the
   type/borrow checker or codegen. The one-way-door claim is true for DEEP changes and is not a door
   at all for shallow ones.
5. **Also record the standing tripwire:** *the moment `[language] version=` is read by the compiler to
   select between two behaviours for the same syntax — not merely as a manifest field — it HAS become
   an edition mechanism regardless of its name.*

## Why the old reasons are gone — do NOT reinstate either

- **The `-std=` / `go 1.x` premise (the PA's) was REFUTED in round 1.** Go 1.22's loop-var change is
  gated **per package** off the module's `go` line; `cmd/compile` carries BOTH semantics and selects
  between them in one build, one binary. That is what editions ARE. C++ `-std=` likewise — *"a
  labeling move, not a design move."*
- **The "no separate compilation" premise (standing rec #3) was REFUTED in round 2 by BOTH late
  voices** — GHC runs a per-file rule-set boundary inside whole-closure-from-source compilation, with
  no registry and no separate compilation. The corrected load-bearing fact is **no registry / no
  independently-versioned units** (`SPEC.md:23341`).

## Two findings to record so they are not mis-cited later

- The *"tripwire already tripped"* claim is **REFUTED**: §62.6 is a subset/ceiling gate, not a
  divergent rule-set, **and it is 100% unbuilt** (0 fire sites for `E-LANGUAGE-VERSION-TOO-NEW`,
  `scrml.toml` parsed nowhere). Verify both halves yourself before writing them down.
- Recommendation #6's instrument is **INERT**: `chunks.json` is WRITE-ONLY (0 read sites), so
  retaining a chunk retains compiled OUTPUT, not the ability to compile the form. Verify by grep.

## Scope — and the hard boundary

**IN:** `compiler/SPEC.md` §62.8 (and §62.9 cross-refs if the reframe requires it) ·
`docs/changes/language-version-and-deprecation-lifecycle-2026-07-01/RULING.md` (D1 + D4) · marking the
two dpa-034 deep-dives in `../scrml-support/docs/deep-dives/` per §2 same-landing supersession if the
reframe supersedes any of their conclusions.

**OUT — do NOT touch:** `handOffs/dpa-queue.md` (the PA owns it and has an unmerged change in flight) ·
any compiler source · §62.6 · §63 · anything outside the sections named above. **`remove-only-at-a-MAJOR`
is being opened as its own deliberation by the PA — do NOT decide it, do NOT amend §63.3 toward it.**
Note it as an open question where §62.8's new text would otherwise imply an answer.

## Gates

- **Rule 4 governing-sentence gate.** Read §62.8, §62.6, §62.9 and §63.3 IN FULL via `offset:`/`limit:`
  before editing. Quote what you are changing, verbatim, in your report.
- **Rule 4b provenance, INLINE at the amended section** — `> **Provenance:** ruling:user-voice-scrml.md S353`
  under the amendment banner, plus `supersedes:` pointing at whatever prior reasoning the reframe
  overturns. The backward half is the one that gets skipped; do not skip it.
- **Direction-of-change: this SHALL be `inert`.** No program's acceptance or meaning may change. Prove
  it: compile the corpus before and after and diff the artifacts + diagnostics. If ANY diff appears,
  STOP — you have changed behaviour and this brief does not authorize that.
- **§2 same-landing supersession** for every write-once doc whose conclusion this overturns:
  `status:` + `superseded-by:` + an in-body banner, in THIS landing.

## Startup (worktree is cut from `origin/main`, not from the PA's checkout)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
   `git rev-parse --show-toplevel` equals it; tree clean. If ANY check fails, STOP and report.
2. `git merge-base HEAD origin/main` == `origin/main` — assert loudly.
3. `bun install`, then `bun run pretest`.
4. This BRIEF + the ruling record are on branch `bank/s353-three-rulings`:
   `git fetch origin bank/s353-three-rulings && git checkout FETCH_HEAD -- docs/changes/dpa-034-editions-reground-2026-08-19/`

## Path discipline + crash recovery

Absolute paths UNDER your worktree root only. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`.
`--cwd "$WORKTREE_ROOT"` for `bun`, `git -C "$WORKTREE_ROOT"` for git. First commit:
`WIP(dpa-034): start at $(pwd)`. Commit AND push after every unit; append-only timestamped
`progress.md` in the change dir. NEVER `--no-verify`; never override `core.hooksPath`.

## Report back

Workspace path · final SHA · files touched · the verbatim BEFORE text of every sentence you struck ·
the inert proof (corpus diff, both directions) · which write-once docs you marked superseded and how ·
anything you deferred and why.
