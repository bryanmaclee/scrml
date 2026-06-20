# BRIEF — giti + 6nz pa.md modernization (S209)

Bring `giti/pa.md` and `6nz/pa.md` up to scrml's CURRENT PA practices. INSERT the modern-practices
section below into each (adapted per project); FIX 6nz's currency rot; PRESERVE all existing
project-specific content (insert, NEVER cut — memory `doc_cleanup_reorg_not_content_cut`).

## NON-NEGOTIABLES
- You edit ONLY `/home/bryan-maclee/scrmlMaster/giti/pa.md` and `/home/bryan-maclee/scrmlMaster/6nz/pa.md`
  (+ commit in those two repos). Do NOT touch the `scrml` repo, `scrml-support`, or anything else.
- Run NON-isolated; edit the sibling files directly via ABSOLUTE paths (NO worktree).
- After your work, `git -C /home/bryan-maclee/scrmlMaster/scrml status --porcelain` MUST be empty
  (you must not have touched scrml). Verify + report it.
- Commit in each repo with an EXPLICIT pathspec (`git -C <repo> commit -- pa.md`). NEVER `--no-verify`.
  Do NOT push (the PA/user coordinates pushes).
- You are ADDING a section + fixing 6nz currency. Do not rewrite or drop existing content.

## STEP 1 — read the source for fidelity
Read `/home/bryan-maclee/scrmlMaster/scrml-support/pa-scrml.md` — the sections "wrap" · "Hand-off
context-density directive" · "Context budget — when to suggest wrap" · Rule 4 + Rule 5 · the
commit-discipline / worktree-isolation / S147-coherence addenda. The section below distills them;
confirm you don't contradict the canonical text.

## STEP 2 — INSERT this section into BOTH files
Place as a new top-level `## Modern PA workflow` section AFTER the existing "Commit rules" /
"Commit authorization" section and BEFORE "PER-REPO PA SCOPE". Verbatim (adapt only the bracketed
per-project notes):

---
## Modern PA workflow (S209 — adopted from scrml's current PA practice)

Cross-cutting PA disciplines scrml developed; they apply to any ecosystem PA.

### "wrap" — a defined operation, not a vague directive
When the user says "wrap" (or you propose it), execute ALL of: (1) **hand-off** — update `hand-off.md`
per the density directive below; (2) **master-list** — current counts/statuses/inventory deltas;
(3) **CHANGELOG** — a new dated session block at the top of `docs/changelog.md`; (4) **inbox/outbox** —
process `handOffs/incoming/` (move read → `read/`), send any due cross-repo notices; (5) **test-suite** —
run + record pass/skip/fail [giti: `bun test`; 6nz: N/A until implementation exists]; (6) **working-tree** —
verify clean OR commit pending work (no silent uncommitted state at close); (6b) **worktree-cleanup** —
`git worktree remove` every landed agent worktree, `git branch -D` its branch, `git worktree prune`;
(6c) **maps-refresh** — `project-mapper` incremental on the session's changed files, committed with an
EXPLICIT pathspec. (7) **push** — or surface push-pending explicitly in the hand-off. (8) **meta-docs** —
user-voice (new durable directives), findings, any meta-doc with state to record. "wrap" = all steps;
"wrap, no push" = 1–6 + 8 with 7 left explicit-pending.

### Hand-off context-density (never make the next PA re-acquire)
Err on the side of bloat to capture every in-flight thread, open question, state transition, and
recovered-from anomaly. Every thread gets its own section; every recovery is documented (what went
wrong + how it was recovered + what to watch); open questions enumerated at the TOP so the next
session surfaces them first; state-as-of-close tables; a file-modification inventory at close. Bloat
is acceptable; under-documentation is not.

### Commit / push hygiene
- Commit with an EXPLICIT pathspec (`git commit -- <files>`) whenever any non-isolated agent or
  parallel work is in flight — a bare `git commit` sweeps unrelated staged work into the commit.
- NEVER bypass the pre-commit hook (`--no-verify`) without explicit user authorization.
- Coherence check before any push: `git rev-list --left-right --count origin/main...HEAD` (catches a
  committed-leak-onto-a-local-ref, which `git status` cannot show); confirm the branch tip == the
  SHA you intend to push.
- Background-commit race: a `git commit` run in the background returns BEFORE its hook + commit
  finalize — commit in the FOREGROUND when you need the resulting SHA next, or wait for the
  completion signal before reading HEAD.

### Worktree isolation + path-discipline (dev-agent dispatch)
- Background implementation agents use `isolation: "worktree"` to avoid working-tree conflicts; the
  PA lands their work via file-delta (`git checkout <agent-branch> -- <files>`) AFTER a base-check —
  verify the agent's base vs current main: a clean clobber if main hasn't touched the file since the
  base, a cherry-pick if it has.
- A sub-agent must write ONLY worktree-relative paths; a main-absolute path silently leaks into the
  live checkout. The PA verifies `git status` post-dispatch shows no unexpected main-side file mods.

### R26 — verify before claim (bidirectional)
Verify against the REAL source before claiming a thing CLOSED (a regression test that synthesizes
state can miss the upstream bug) AND before claiming it OPEN / dispatching a fix (an observation can
be a stale read — if the symptom doesn't reproduce against the real current source, classify
NOT-REPRODUCED, not OPEN).

### Context-budget wrap-timing (1M context)
This PA runs on a 1M-token window. Do NOT suggest wrap on context-% alone above ~50% remaining. The
default wrap-suggestion threshold is ~15–20% remaining. Earlier wrap only with a real reason (a
natural stopping point, a user signal, or context-density degrading). The user tracks budget as a
pacing tool — honor their explicit budget signals over conservative reflexes.

### Background-agent crash-recovery
When dispatching any background agent, instruct it to: commit after each meaningful change (don't
batch; WIP commits are fine) and update a progress file (`docs/changes/<change-id>/progress.md`)
after each step. The branch + progress file are how the next agent (or the PA) picks up after a crash.

### The flogence satellite system (available, NOT imposed)
scrml built a PA-continuity satellite system — **vPA-deputy** (token-thinning maintenance sidecar:
session-start digest + a PA→deputy delta-log), **sPA** (speciality work-list execution that lands on
a branch the PA re-integrates), **cPA** (an always-on latency-bridge concierge). These are scale
solutions for scrml's large gap-backlog; a smaller project does not need them. If [giti / 6nz] grows
to where session-start cost or execution throughput becomes a real bottleneck, the contracts live in
`scrml-support` (`vpa-scrml.md` / `spa-scrml.md` / `cpa-scrml.md`) as adoptable patterns. Until then:
not imposed — a single PA with the disciplines above is the model.
---

## STEP 3 — 6nz currency fixes (`6nz/pa.md` only)
- `scrmlTS` → `scrml` everywhere (S200 rename: the compiler repo is now `scrml`; the self-host is
  `scrml-native`). The `../scrmlTS/` path → `../scrml/`.
- `/home/bryan/scrmlMaster/` → `/home/bryan-maclee/scrmlMaster/` (home dir is `bryan-maclee`).
- `6NZ` → `6nz` in ALL paths (the repo dir is lowercase; uppercase `6NZ` strands inbox messages —
  case-sensitivity precedent stranded 9 cross-repo messages).
- The "Agent staging via master" `agentStore` mechanism is DEAD — there is no `agentStore`. Reframe:
  "author expert agent `.md` files directly into `.claude/agents/` (gitignored); no central store."
  Apply this same `agentStore` fix to `giti/pa.md` too (it carries the identical dead reference).

## STEP 4 — adaptation
- giti: implementation + 88 tests exist → the wrap test-suite step applies (`bun test`).
- 6nz: design-phase, no code yet → wrap test-suite step N/A "until implementation exists"; lean on
  design-doc / spec currency discipline.

## STEP 5 — commit + report
- `git -C /home/bryan-maclee/scrmlMaster/giti commit -- pa.md` — msg: "pa: modernize — adopt scrml
  current PA practices (wrap / hand-off-density / commit-hygiene / worktree-isolation / R26 /
  context-budget / crash-recovery) + agentStore fix".
- `git -C /home/bryan-maclee/scrmlMaster/6nz commit -- pa.md` — msg: same + " + currency
  (scrmlTS→scrml · paths · 6NZ→6nz case · agentStore)".
- REPORT: per-file change summary, both commit SHAs, and confirm `git -C .../scrml status --porcelain`
  is empty (scrml untouched). Maps not load-bearing (PA-contract doc task).
