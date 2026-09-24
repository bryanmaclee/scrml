# BRIEF — s430-p2-export-swallow (dispatched S430, bryan-ruled)

## RULING (bryan, S430, verbatim): "yes, close it and migrate"
Close the export-declaration diagnostic SWALLOW and migrate the corpus it newly rejects, in ONE arc.

## THE DEFECT (PA-verified by execution on main 15e60e4b)
Inside an `export`-ed declaration, the synth re-parse keeps only `E-FN-EQUALS-BODY` from its sub-parse
diagnostics and discards the rest. SPEC §34 already documents it (the `E-CONDITION-HEAD-UNPARENTHESIZED`
row, "EXCEPT INSIDE AN `export`-ED DECLARATION, WHERE IT IS SWALLOWED"). Measured by the PA:
- `function f() { try { g() } catch (e) { h() } }` → `E-TRY-NOT-IN-SCRML`, FAILED.
- `export function k() { try { g() } finally { h() } }` → only `W-TRY-CATCH-IN-SCRML-SOURCE`, exit 0.
Governing sentence: SPEC §34 `E-TRY-NOT-IN-SCRML` — "scrml has no `try`/`catch`/`finally` … `try` earns a
parse-layer rejection." Same for `E-THROW-NOT-IN-SCRML`. Direction: newly-rejecting (restoring the contract).

## LOCUS — PA-LOCATED-VERIFY (a hypothesis, not a trace)
`compiler/src/ast-builder.js`, the `export function` synth re-parse `_subErrors` site. The PA found it by
reading SPEC prose and grepping `E-FN-EQUALS-BODY` (~:3920-3934), NOT by tracing. Report whether the
hypothesis held, was refined, or was wrong. Fix the ROOT (surface ALL sub-parse diagnostics, with spans
mapped correctly to the source), not a per-code allowlist extension.

⚑ Related, verify: `g-class-is-a-front-end-blind-spot` — `export class X {}` compiles to NOTHING at exit 0.
Check whether this swallow is part of why. bryan ruled S430 that `class` is REJECTED from scrml (a new
`E-CLASS-NOT-IN-SCRML` code is a separate arc — do NOT add it here), so do not "fix" class emission; just
report whether the swallow hides class diagnostics.

## PHASES
1. **Measure first.** Close the swallow on your branch, then compile the WHOLE tracked corpus (every tracked
   `.scrml`, incl. `stdlib/`, `compiler/native-parser/*.scrml`, `compiler/self-host/*.scrml`, samples,
   examples) on base AND on your build. Report the NEWLY-FAILING file set with codes — S414 measured
   22/2,553 (17 E-THROW, 7 E-TRY, 1 E-STMT-MISSING-SEMICOLON) but that is 16 sessions stale. COMPILE, never grep.
2. **Migrate** each newly-failing site to canonical scrml:
   - a caught HOST throw → `safeCall` / `safeCallAsync` from `scrml:host` + `!{}` arms;
   - a domain error → `!` failable signature + `fail Type::Variant(...)`;
   - `throw` → `fail`.
   - ⚑ **`try … finally` (cleanup on both paths) → DO NOT MIGRATE.** scrml has no scope-exit primitive yet;
     that is ruling P3, being decided NOW. List every finally site (file:line + what it releases) and leave
     it. If finally sites exist, the arc cannot land until P3 is ruled — say so in your report.
   - Any other shape you cannot map without inventing semantics → list it, don't guess.
3. **Differential.** For each migrated file, the emitted artifact's behaviour must be preserved; run the
   file's existing tests. Full suite `bun run test` green except the known `api-decl-codegen` 5s timeout.
4. Add unit tests: E-TRY/E-THROW fire inside `export function`, `export fn`, `export const g = () => …`, a
   function nested in an export; E-FN-EQUALS-BODY still fires; spans point at the real source line.

## RULES
- Anti-pattern briefing: read `../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` and
  `docs/articles/llm-kickstarter-v2-2026-05-04.md` before writing any scrml.
- MAPS: `.claude/maps/primary.map.md` is stamped 787d4cb4, ~50 commits behind HEAD — treat map content as a
  verify-against-source hypothesis.
- F4: first action `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
  `git merge-base HEAD origin/main` == `git rev-parse origin/main`; `bun install`; run `bun run pretest` from
  the worktree CWD (NOT `bun --cwd … run`, it silently no-ops). Edit/Write only on worktree-absolute paths.
  Never `cd` into main. Never `git stash`. Never bare `pkill -f`. Private scratch: use
  `<worktree>/.scratch/` only.
- Fetch this brief onto your branch: `git fetch origin s430/p2-export-swallow && git checkout FETCH_HEAD --
  docs/changes/s430-p2-export-swallow/`.
- Commit after each unit of work (WIP ok); keep `docs/changes/s430-p2-export-swallow/progress.md` appended.
  Never `--no-verify`, never override hooksPath.
- Report: branch, FINAL_SHA, files touched, the newly-failing set (before/after), the finally-site list,
  locus hypothesis held/refined/wrong, anything found along the way.
