## STARTUP + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; else STOP and report. `git checkout -B gaps/s460 origin/main` (verify base `b4b94f3d6` or later). `bun install`.
2. Absolute paths under your worktree only. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. No `git stash`, no pattern `pkill`, no `--no-verify`. `TMPDIR=/home/bryan-maclee/.cache/scrml-agent-tmp/s460-gaps/` per command.
3. First commit: this prompt verbatim → `docs/changes/s460-gaps/BRIEF.md` + `progress.md`. Commit incrementally.

## Task — file gap entries in `docs/known-gaps.md` (docs only; no compiler source changes)
Follow the file's existing entry form exactly: a `<!-- @gap id=g-<kebab-slug> sev=HIGH|MED|LOW status=open locus=<path[:symbol]>|searched:<a,b> prov=<kind>:<pointer> -->` marker + a `### G-<ID-UPPERCASED> — <one-line symptom>` heading + body (symptom, reproducer pointer, expected vs actual, source). Severity tiers are ONLY HIGH/MED/LOW/NOMINAL. Read several recent S457–S459 entries first to match style. A locus is located-not-traced — say so unless you traced it. Before filing each, grep known-gaps for an existing entry covering it; if one exists, add a dated "S460 also:" note instead of a duplicate.

Sources:
A. `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/one-presence-test-dpa-070-2026-10-08.md` §11 "Defects routed" D1–D15 + P2 + P3 (skip D16 — it is a ruling conflict the PA is handling; skip P1 — doc nit, but you MAY fold it as a LOW comment-wording gap with P2). Evidence fixtures live under `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/dpa-070/` (verify the path; cite fixture names). Severity guidance: D6 (narrowing survives writes incl. via a callee → runtime TypeError) is HIGH; D1, D4, D5, D7, D8 produce runtime errors or silent wrong control flow — MED at least, HIGH if the fixture shows a runtime TypeError/ReferenceError on code the SPEC calls valid; D12/D13 SPEC self-contradictions LOW; use judgment and state it. `prov=dd:scrml-support/docs/deep-dives/one-presence-test-dpa-070-2026-10-08.md`.
B. From the S460 differential review of branch `s459-refine-copy-in` (refinement copy-in, §53), file:
 - `g-refinement-recursive-struct-judge-depth-1-s459` (MED): a recursive struct refinement is judged one level deep — `type T:struct = { n: number(>0), kids: T[] }`, `@t.kids[0].kids[0].n = -5` admitted; levels 0–1 refused. Root (dev's trace): recursion cut in refinement-obligations `judgeTypeOf` (S458 2a-fix F3 memo); fix: a recursive struct reference calls its own hoisted judge by name. Lands with the copy-in branch (not yet on main) — note "present once s459-refine-copy-in lands".
 - L-D (MED): values inside a refined MAP field are never judged — `{ n: number(>0), m: [string: L] }` admits a whole write with an `n:-1` map value and `m.get("x").n = -1`. Pre-existing.
 - L-C (LOW, semantics note): a whole write to a refined cell gives the cell's own nested elements new identities — `const a=@w.rows[0]; @w={rows:[...@w.rows],name:"z"}; @w.rows.indexOf(a)` → -1 (unrefined: 0); a find-by-reference-then-splice handler silently no-ops. Consequence of the S459 copy-in ruling; file so it is visible, `prov=ruling:user-voice-scrml.md S459 "a, go"`.
 - I-1 (LOW): a hostile array proxy with an ever-growing `length` makes the copy loop unbounded.
 Reviewer reproducers: `/home/bryan-maclee/.cache/scrml-agent-tmp/s460-rev-copyin/p/` (`j.mjs` filters f3/f4/f5, e3; `g2.mjs` with `s1.mjs ident-own-grandchild-*`) — cite, do not copy into the repo.
Then regenerate the §0 rollup: `bun scripts/state.ts --write` and confirm `bun scripts/state.ts --check` passes. Commit (pre-commit hook runs; foreground, allow ~5 min).

## Report
Branch + final SHA, list of gap ids filed (id · sev · one-line), any merged into existing entries, and the state.ts check result. Do NOT push or open a PR.
