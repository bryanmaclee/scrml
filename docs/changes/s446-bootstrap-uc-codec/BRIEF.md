# BRIEF — s446-bootstrap-uc-codec (bootstrap arc Uc: the §57 wire codec)

You are working on the scrml **bootstrap compiler** (impl#2, `compiler/self-host-v2/**`, written in scrml, run by
impl#1). This is unit **Uc** of the bootstrap server-boundary arc. Plan (READ FIRST, it is short):
`/home/bryan/scrmlMaster/scrml-support/docs/deep-dives/bootstrap-server-boundary-arc-plan-2026-09-30.md`.
Loci there are [R]ead or [I]nferred at `29eb80c31` — PA-located-verify; report held / refined / wrong.

A sibling agent (U0) is concurrently changing the bootstrap Core + runtime (`core.scrml`, `lower.scrml`, `parse.scrml`,
`analyze.scrml`, `slice-m1/runtime/runtime.js`). **Your write set must be DISJOINT from theirs:** create NEW files only
(e.g. a codec module + its runtime half + tests in a new `slice-*`/test location). You may READ any file. If you find the
codec genuinely cannot be built without editing one of those shared files, STOP and report exactly what edit you need.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` MUST
   equal `pwd`. `git status --short` MUST be clean. `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main`.
   If any check fails: STOP, report, exit.
2. `bun install` then `bun run pretest` (plainly from the worktree CWD — `bun --cwd <path> run` silently no-ops).
3. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. NEVER write under the main checkout. NEVER `cd`
   into it. Use Edit/Write, not Bash heredocs/redirects, for edits.
4. NEVER `git stash` (shared across worktrees). NEVER `pkill -f`/`killall`; kill only by a captured PID.
5. First commit: `WIP(s446-uc): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `464c9ab4d`, 2026-10-01) first; follow Task-Shape Routing for self-host work (2–4
maps). Main moved only by docs/maps/wrap PRs since (#1203–#1205). Maps are a hypothesis; report whether load-bearing.

## Policy (S435)
impl#1 (`compiler/src/**`) is NOT changed. Study impl#1's encoder/decoder as prior art only (find it — the §57 envelope
`__scrml_absent`); do not port blindly, and record any impl#1 divergence from §57 you notice.

## What to build
Governing source: **SPEC §57 Wire Format** (read IN FULL; quote what you implement in progress.md), plus **§59.10**
(map serialization — Core has no Map yet, so note it as out of scope), **§42** (`not`), **§12.5.1**. The plan scopes the
codec to Core types Int / Num / Str / Bool / Named(struct/enum) / Seq / Maybe(`T | not`).
- A TYPE-DIRECTED encoder (value + Core type → JSON-safe value, absence as the canonical §57 envelope) and a
  TYPE-DIRECTED, FAIL-CLOSED decoder (JSON + Core type → value or a typed decode failure; never coerce). §57.4's
  dual-decoder (accept envelope AND raw null where §57 says so) — implement exactly what the text says.
- This codec will be consumed by U1 (server boundary: server-fn args/returns) and U5 (`persist=`, SPEC §6.14 —
  "decoded against the CURRENT type + full contract; any failure → the default"). Read §6.14's decode clauses and make
  the decoder's failure result usable for that (a value, or a failure the caller can map to "use the default"). Contract
  checks beyond shape (refinements/validators) — note what exists in Core and what U5 will need; do not build U5.
- Enum encoding must match whatever §57 / impl#1's envelope says for variants with payloads; if SPEC is silent on a
  shape, STOP and report it as a SPEC question with impl#1's observed behaviour — do not invent a wire shape.
- Tests: round-trip property-style tests over every supported type incl. nested `Seq[Maybe[Named]]`, `not` at every
  nesting level, decode-failure cases (wrong type, missing field, extra field — say what §57 implies), and a
  cross-implementation test: values encoded by impl#1's runtime decode identically in yours (and vice versa) for the
  shared shapes.

## Verification (do not report DONE without these)
- New tests green; bootstrap suites unchanged-green; core gate `bun test compiler/tests/{unit,integration,conformance}
  --bail` green via the hook (never `--no-verify`); top-level `compiler/tests/*.test.js` green.
- Bite proof: corrupt the absence envelope key in your encoder, show tests go red, restore.

## Discipline
Commit after every meaningful unit; `docs/changes/s446-bootstrap-uc-codec/progress.md` append-only timestamped. Clean
`git status` before reporting.

## Report (final message)
worktree path · branch · FINAL SHA · files touched (confirm disjoint from U0's list) · governing sentences quoted · loci
verdicts · maps load-bearing? · tests + counts · SPEC questions · impl#1 divergences · path-discipline incidents.
