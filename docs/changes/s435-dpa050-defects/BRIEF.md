You are filing compiler defects into the scrml gap ledger. Docs/ledger work only — you do NOT fix any compiler code.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do this first; PATH-DISCIPLINE INCIDENT counter: several prior)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP and report.
2. `git rev-parse --show-toplevel` == that pwd. `git status --short` clean.
3. Your worktree is cut from origin/main; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main` (fetch first).
4. `bun install` in the worktree.
5. EVERY Write/Edit uses an absolute path UNDER your worktree root. NEVER write to `/home/bryan-maclee/scrmlMaster/scrml/<anything>` outside `.claude/worktrees/`. Never `cd` into the main checkout. Never use `git stash` (it is shared across worktrees). Never `pkill -f` by command string.
6. First commit: `WIP(s435-dpa050-defects): start at $(pwd)`. Commit after every meaningful change; keep `docs/changes/s435-dpa050-defects/progress.md` (append-only, timestamped).
7. Save this entire prompt verbatim to `docs/changes/s435-dpa050-defects/BRIEF.md` in your worktree and commit it.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp 787d4cb4 / 2026-09-18 — STALE: many landings since; treat every locus it gives as a hypothesis to verify against source). Report whether the map was load-bearing ("not load-bearing" is a valid answer).

## The task
A deliberation artifact, `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/declaration-syntax-instances-and-self-write-dpa-050-2026-09-24.md` (read-only for you; read §2 in full, and §9.4), found seven compiler defects (§2.3, D1–D7) plus a stale-comment defect (§9.4, `compiler/src/symbol-table.ts` near the comment claiming the native walker leaves `messageArms` empty). None are in the gap ledger. Measured at scrml `b22f5e83`; HEAD has moved since. The dPA's probe files are at `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-flogence/dpa050/` (read-only; copy what you need into your own scratch dir).

For EACH of D1–D7 and the stale comment:
1. **Check for an existing entry first** in `docs/known-gaps.md` (search by symptom and by likely symbol, not just by one keyword). If one exists, do NOT duplicate — add a dated note to it citing dpa-050 and the HEAD re-verification instead.
2. **Reproduce on HEAD** by compiling (e.g. `bun compiler/bin/scrml.js compile <file> --output-dir <tmp>`; for runtime claims like D1, drive the emitted output — the dPA used happy-dom; see its `rt.mjs`/`rt3.mjs`). If it no longer reproduces, record NOT-REPRODUCED with the evidence and do NOT file it as open. Watch the known probe traps: check exit codes separately from output; never read "empty output" as "zero"; W-/I- codes land in `result.warnings`, not errors.
3. **Locate the deciding code** — the file (and symbol) where the behaviour is DECIDED, not merely mentioned. If you cannot trace it, record `locus=searched:<files>`. State whether the locus is traced or only located.
4. **File** in `docs/known-gaps.md` using the ledger's existing format exactly (read several recent entries first): an `<!-- @gap id=g-<kebab-slug> sev=HIGH|MED|LOW status=open locus=<path[:symbol]> prov=dd:scrml-support/docs/deep-dives/declaration-syntax-instances-and-self-write-dpa-050-2026-09-24.md -->` marker + a `### G-<SLUG-UPPERCASED> — <one-line symptom>` heading + body: reproducer (inline fenced .scrml, compile command, compiler SHA), expected vs actual, the SPEC sentence it contradicts QUOTED with section (or "searched §X,§Y — no governing sentence"), direction-of-change class if fixed. Severity: use the dPA's as a starting point but judge it yourself; only HIGH/MED/LOW/NOMINAL exist (no CRITICAL). Under the S430 P7 ruling these are likely `status=carried` candidates unless they block the bootstrap, are adopter-reported, or are security — do NOT set carried yourself; note the P7 criterion assessment in the body for the PA.
5. After editing, run `bun scripts/state.ts --write` then `bun scripts/state.ts --check` (the §0 counts are generated) and commit.

Do NOT open a PR, push, or merge. Final report (short): worktree path, final commit SHA, files touched, and per defect: reproduced? · existing-entry-or-new id · sev · locus (traced/located/searched) · one-line evidence. Plus: map load-bearing or not.
