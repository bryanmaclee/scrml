start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a23772f93a26cc364

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE.
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP).
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root; never write outside it; never `cd` into the main checkout. scrml-support is read-only for you.
3. NEVER `git stash`; NEVER `pkill -f`.
4. `bun install` first. Scratch under "$WT/.tmp/" (delete at end).
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-spec-tenant-source/BRIEF.md (body `start at $(pwd)`); progress.md. Never --no-verify. Pre-commit timeout 300000. Run git commands singly.
6. Push as `spec/s452-tenant-filter-at-source`. Do NOT open/merge a PR.

TASK — SPEC amendment for bryan's S452 ruling "a" (read it verbatim: /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md, §S452, entry "RULED — "a" — the tenant floor filters at the SOURCE"). Context: scrml-support/docs/deep-dives/bootstrap-security-provenance-dpa-067-2026-10-04.md (§C1, §C4, Approach D, fork F2).
Read compiler/SPEC.md §14.8.10 IN FULL (~:11910-12060), §14.8.11, §14.8.9's extracted-value rule (S441) for the contrast, and the §34 E-TENANT-* / I-TENANT-* rows. Then amend §14.8.10:
- The floor's mechanism: rows read from a tenant-scoped table SHALL be filtered to the active tenant immediately after the query executes, before any program code observes them; with no active tenant, a read yields no rows (`.get()` → `not`). `.acrossTenants()` remains the only unscoped read, with I-TENANT-ACROSS. State the consequence plainly: server code never observes another tenant's rows unless it opts out, so every derived value (extracted fields, counts, joins, serialized output) is scoped by construction; the egress strip remains as defense in depth.
- Strike/narrow the sentences the ruling supersedes (the strip-at-egress-only model; any soundness-scope disclaimer about derived/implicit flows that the new mechanism now covers — e.g. the "soundness scope" paragraph ~:12015-12021). Keep what still holds (E-TENANT-AGG / E-TENANT-WRITE / E-TENANT-RAW-EGRESS semantics) unless the ruling makes one wrong — flag, don't decide.
- Alignment note with §14.8.11 (the RLS tier now has the same server-side semantics).
- Update the I-TENANT-STRIP §34 row text if it describes the old mechanism.
- Inline `> **Provenance:** ruling:user-voice-scrml.md S452 "a" — *verbatim* · supersedes: … · dd:scrml-support/docs/deep-dives/bootstrap-security-provenance-dpa-067-2026-10-04.md · **Direction of change:** semantics-changed (server code that read all tenants implicitly now sees only the active tenant's rows); impl#1 fix in flight on `fix/s452-tenant-filter-at-source`; bootstrap: not yet built (U1c keeps tenant refused).` 
- Do NOT edit docs/known-gaps.md (a sibling dispatch owns it).
If the SPEC is silent or self-contradictory on something you need (e.g. how filtering composes with `.get()` on a primary-key lookup, JOINs mixing a tenant table with a non-tenant table, subqueries, CTEs), write the clearest reading consistent with the ruling, and MARK each as a PA reading in its veto window inside the provenance — list them in your report.
Gates: `bun run scripts/regen-spec-index.ts` + `--check`; `bun scripts/s34-census.ts --check-new`; `bun scripts/facts.ts --check` (write if needed). Revert any master-list.md hunk.
FINAL REPORT (<400 words): FINAL_SHA (== pushed tip), the new normative sentences (quote), what was struck, the PA readings flagged, gates, `git status` clean.
