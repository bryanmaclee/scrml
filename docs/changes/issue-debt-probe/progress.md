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
- [built] scripts/issue-debt.ts (261L, review-debt.ts house style): pure `classify()`/`mentions()` exported, CLI gated on
  `import.meta.main` (state.ts S307 pattern). Anchored `#<n>(?![0-9])` + `issues/<n>` URL form. Auto-widen ×4 to 2000 with
  a truncation banner (`of ≥N — SCAN MAY BE TRUNCATED`); gh-unavailable → exit 0 + "NOT verified" (never breaks a boot);
  `--json` / `--check` / `--now` / `--repo` / `--gaps` / `--queue`. Committed 66db7c30 with the unit test (one logical unit).
- [bite] compiler/tests/unit/issue-debt.test.js — 12 tests / 33 expects, green. RED-PROVEN twice: (1) unanchored
  `includes` mutant → 3 fail (the #51-vs-#519 case + URL form + bare-number rejection); (2) GAP/DPA label swap → 4 fail.
  Restored → 12 pass.
- [live] `bun scripts/issue-debt.ts` → `issue-debt — 3 open · 0 homed · 3 OWED` against THIS WORKTREE's ledgers
  (base 2709e540 = main, which predates the S346 homing). Against brief/s346-briefs ledgers (--gaps/--queue overrides):
  `3 open · 3 homed · 0 OWED` (#471 HOMED-DPA · #509 HOMED-BOTH · #519 HOMED-GAP) — matches the brief's expectation.
  FINDING for the PA: the homing commits live on brief/s346-briefs, NOT on origin/main — until that branch lands, a
  main-checkout boot will read 3 OWED. Not a probe defect; a branch-state fact.
- [wired] boot.ts allProbes(): runProbe("issue-debt", "Adopter issues (owed a home)", ...) between dpa and issues
  (boot.ts:299 post-edit); header probe list updated (:19-23). `--no-probes` runs clean; full digest renders the probe's
  block; --json probes[] shows issue-debt ok:true.
- [suite] wiring commit 9447694e passed the FULL pre-commit suite: 28812 tests / 1241 files, 0 fail, 100550 expects (271.9s).
  (First attempt of this commit hit the 10-min foreground Bash ceiling mid-hook; re-ran backgrounded — commit is non-empty,
  verified `git show --stat`.)
- [origin/main check] re-fetched: origin/main is still 2709e540 with ZERO `#519/#509/#471` mentions in either ledger —
  the 3-OWED live reading is branch-state truth (S346 homing lives on brief/s346-briefs only), NOT a probe defect.
- [done] pushed both commits; DONE-PROBE (`test -f scripts/issue-debt.ts && grep -q 'issue-debt' scripts/boot.ts`) passes.
