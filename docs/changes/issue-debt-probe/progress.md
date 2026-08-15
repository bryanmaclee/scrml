# progress — issue-debt-probe (S346-bryan dispatch)

branch: feat/issue-debt-probe
worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab8001b8bec5d839f
base: 2709e540 (main at dispatch) + c608ee75 cherry-picked (the BRIEF archive, which lived on brief/s346-briefs and was not in the worktree at cut)

## log (append-only)

- [start] pwd=/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab8001b8bec5d839f · toplevel==pwd · tree clean · bun install ok · branch cut.
- [maps] primary.map.md §Task-Shape Routing (`bun scripts/boot.ts` row) + build.map.md read. Load-bearing: boot DELEGATES probes to
  authoritative scripts, never reimplements ("a second implementation of a probe is a second thing that can be wrong");
  every `scripts/` probe is DETECTION-NOT-CONTROL and none is a CI gate; `scripts/` IS in the review-floor code-bearing
  population; and dpa-debt.ts's classifier lesson — an UNANCHORED contains-match is the repeating false-positive class
  (#492 PICKUP indexOf · S337 ledger regex · dpa-022/023) — is exactly the `#51`-vs-`#519` word-boundary requirement here.
- [pattern] no sibling script test exists (`git ls-files | grep -E 'review-debt|threads' | grep test` → empty). The importable-
  script precedent is scripts/state.ts (`import.meta.main` gate, S307) with tests at compiler/tests/unit/*.test.js importing
  `../../../scripts/state.ts` — mirroring that: compiler/tests/unit/issue-debt.test.js.
- [premise] live `gh issue list --state open` → #519 #509 #471 (each 1 comment now). Their homes (#519 gap entry, dpa-028/029)
  are on brief/s346-briefs, NOT on origin/main and NOT in this worktree's base — so the probe run against the WORKTREE ledger
  will read 3 OWED by branch-state, and against the brief-branch ledgers 0 OWED. Both will be reported.
