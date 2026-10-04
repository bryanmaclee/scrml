# BRIEF — s452-spec-fixups

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac807f4c413c9449a

---

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero; this block exists because of them).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- . `git rev-parse --show-toplevel` MUST equal pwd. Clean tree. `git fetch origin main`, then `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (if not: `git merge --ff-only origin/main`; if that fails, STOP and report).
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. NEVER write under /home/bryan-maclee/scrmlMaster/scrml/ outside your worktree. NEVER `cd` into the main checkout.
3. NEVER `git stash`. NEVER `pkill -f`/`killall`.
4. `bun install` first. Scratch under "$WT/.tmp/" (delete before final report).
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-spec-fixups/BRIEF.md (body: `start at $(pwd)`); keep docs/changes/s452-spec-fixups/progress.md. Never --no-verify. Pre-commit ~2 min: timeout 300000. Run git commands singly (the worktree guard rejects compound git commands).
6. Push your branch as `spec/s452-fixups` (normal push). Do NOT open or merge a PR.

TASK — SPEC-text-only currency fixes in compiler/SPEC.md, found by the S451 nav-map refresh (.claude/maps/non-compliance.report.md, stamp d3e660a08 — read the N-S451-2 and N-S451-3 entries there first). No compiler source changes (impl#1 under compiler/src/ is frozen; do not touch compiler/self-host-v2/ either).
1. N-S451-2: §8.1.1 still describes `g-impl1-db-resolution-not-nearest-s451` as a LIVE divergence — #1264 resolved it (impl#1 now resolves each `?{}` to its nearest database scope). Verify that by reading docs/known-gaps.md (status of that gap) and the #1264 change (`git log --oneline --grep=nearest`), then rewrite the affected SPEC sentences to current truth (keep the provenance; mark what was resolved and by which landing). Also the three E-SQL-004 §34 rows cite `compiler/src/codegen/emit-server.ts:7000` (stale) — locate the real emit sites by SYMBOL (grep for "E-SQL-004" under compiler/src/), cite file + the enclosing function name rather than a line number where possible (line numbers rot).
2. N-S451-3: `E-INTERNAL-DB-HANDLE-UNRESOLVED` (added by #1264 in impl#1) has no §34 row — add one in the right §34 table (find how other E-INTERNAL-* codes are catalogued; match the row shape: Code | Section | Trigger | Severity). Note two E-SQL-004 diagnostic MESSAGES in impl#1 still carry the pre-S451 wording "no `db=` in any ancestor `<program>`" — do NOT edit them (frozen impl#1); instead file a gap entry in docs/known-gaps.md with a `locus=` and `prov=` on its `@gap` marker per the existing entry format (copy the form of a neighbouring `*-s451` entry), sev=LOW.
3. §19.9.10 says "the bootstrap builds it" — not yet true (it lands with the bootstrap's U1b slice). Reword to say it is specified here and lands with the bootstrap's client server-call slice; do not change the rule.
Do NOT add §34 rows for bootstrap-only codes (E-PARSE-ARM, E-PARSE-SQL-CHAIN) — another dispatch owns those.
After editing: `bun run scripts/regen-spec-index.ts` then its `--check`; `bun scripts/state.ts --check` (regenerate with --write if the gap count moved, and confirm only the expected hunk changed in master-list.md / known-gaps.md); `bun scripts/facts.ts --check`.
Every changed normative sentence gets an inline `> **Provenance:** …` note per the SPEC's existing convention (kind `spec:` or `rationale:` — these are currency corrections, not new rules). Direction of change for every edit should be INERT (no program's acceptance changes); if any edit is not inert, STOP and report it.
FINAL REPORT (<400 words): worktree, FINAL_SHA (== pushed tip), each item done + what you verified, gates run, `git status` clean.
