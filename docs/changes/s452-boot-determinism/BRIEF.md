# BRIEF — s452-boot-determinism (archived verbatim at dispatch)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab512a0102040a9a7

---

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ e7fb5fba5.
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root; never write under /home/bryan-maclee/scrmlMaster/scrml/ outside it; never `cd` into the main checkout.
3. NEVER `git stash`; NEVER `pkill -f`/`killall`.
4. `bun install`, then `bun run pretest` from your worktree cwd. Scratch under "$WT/.tmp/" (delete at end). TMPDIR if set → ~/.cache/scrml-agent-tmp/s452-boot-determinism.
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-boot-determinism/BRIEF.md (body `start at $(pwd)`); progress.md append-only. Code + tests in one commit per unit. Never --no-verify. Pre-commit timeout 300000. Run git commands singly.
6. Push as `feat/s452-boot-determinism` (normal push). Do NOT open/merge a PR.

MAPS: .claude/maps/primary.map.md (stamp d3e660a08; post-map #1274 bootstrap rulings). Report whether load-bearing.
AUTHORING scrml: read /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md (read-only); mirror the surrounding bootstrap idiom.
CONCURRENCY: sibling dispatches are live — `feat/s452-boot-arm-pipe` (bootstrap parse.scrml/analyze.scrml lint for `|`-led arms + the severity table) and `feat/s452-arm-pipe-deprecation` (impl#1 compiler/src + corpus). Avoid parse.scrml's arm parser and anything under compiler/src/ ; if determinism work requires touching them, STOP and report.

TASK — bryan, S452 ("looks good, go on DDs and 3", user-voice-scrml.md §S452): make the BOOTSTRAP compiler (compiler/self-host-v2/) a deterministic, pure function of its explicit inputs — the cheap half of SPEC §58 (Build Story; read §58.1 and §58.12 IN FULL and quote the governing sentences in progress.md; §58 is Nominal — do NOT build the lockfile/Merkle closure; only the determinism property).
1. SURVEY first (report it): every place the bootstrap compiler (and its driver/harness — find how it is invoked: the slice harnesses, scripts/bootstrap-conformance.ts, any CLI entry) reads ambient state or depends on unspecified order: filesystem enumeration order (readdir), absolute paths / cwd / home dir leaking into output, `Date`/clock, `Math.random`, env vars, object-key / Map / Set iteration over insertion orders that depend on input order, hash/id counters that depend on traversal order of files, locale-dependent string compare (`localeCompare`), floating-point formatting. Classify each: (a) affects emitted artifacts, (b) affects diagnostic ORDER or text, (c) inert.
2. FIX (a) and (b): make the compile a pure function of (the SET of source files with their project-relative paths + contents, the compiler, explicit options). Canonical ordering by project-relative path; no absolute paths in artifacts or diagnostics (project-relative only); no clock/random/env in output. If a source of nondeterminism lives in the HARNESS rather than the compiler, fix it in the harness and say so.
3. TEST — a determinism gate: (i) compile a multi-file program twice → byte-identical artifacts + identical diagnostics (order included); (ii) same file set presented in shuffled order → identical; (iii) same project from two different absolute roots / cwds → identical; (iv) a program that emits diagnostics in several files → identical order. Put it with the slice-m4 tests (run BY PATH — see .github/workflows/ci.yml) so the blocking CI job runs it. Prove the gate bites: temporarily inject a nondeterminism (e.g. reverse the file order) → test red; restore → green; record this in progress.md.
4. Counter: `bun scripts/bootstrap-conformance.ts` PASS ≥ 119, doc regenerated + `--check`; `bun scripts/gen-bootstrap-severity.ts --check`.
FINAL REPORT (<450 words): FINAL_SHA (== pushed tip), the survey table (site · class · fix), the gate + bite proof, test counts, counter, `git status` clean.
