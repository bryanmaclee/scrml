# DISPATCH BRIEF — engine `effect=` diagnostics (change-id: engine-effect-diagnostics-2026-06-11)

You are fixing TWO engine-diagnostic gaps in the scrml compiler (TS/JS). Both are **diagnostic/parser-only — ZERO codegen change** (the canonical `${}` forms already emit correctly; you are adding a diagnostic for a silently-dropped malformed form + de-duplicating a double-fire). Full scoping at `docs/changes/engine-effect-diagnostics-2026-06-11/SCOPE-AND-DECOMPOSITION.md` (read it first — it has the precise loci + root causes).

## MAPS — REQUIRED FIRST READ

Before consuming any other context (SPEC sections / source files), read `.claude/maps/primary.map.md` in full (~100 lines). The §"Task-Shape Routing" section tells you which additional maps to consult for a **compiler-source bug fix** (likely error.map + structure.map). Follow that routing.

Map currency: maps reflect HEAD `5a51c1ca` as of 2026-06-11 (the live HEAD is `0a11f908` = the maps-refresh commit itself; no source changed after the watermark, so the maps are source-current). If your work touches files modified after that point, verify via grep/Read against current source.

Feedback in your final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing." Both are valuable.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is whatever `pwd` reports at startup — it MUST be under `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-<id>/`.

### Startup verification (BEFORE any other tool call)
1. `pwd` via Bash. MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report (S90 CWD-routing failure). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` — worktrees don't inherit `node_modules` (pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
5. `bun run pretest` — populates gitignored `samples/compilation-tests/dist/` (browser tests load it). Use `bun run test` (chains pretest) NOT `bun test` for baseline checks.

If ANY check fails: DO NOT proceed. Report + exit.

### Path discipline (EVERY Read/Write/Edit/Bash call)
- Apply edits via **Bash** (perl/python3/heredoc) on **worktree-absolute paths** that include the `.claude/worktrees/agent-<id>/` segment; echo the path before each write + re-verify via `git diff`/`grep` after (S126 — the Edit/Write tool can write to MAIN while your Bash/git view sees the worktree).
- NEVER use relative paths (resolve against main) or main-rooted absolute paths. NEVER `cd` into the main repo — use `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"`, worktree-absolute paths exclusively.

### Commit discipline (crash-recovery)
After every edit: `git diff <file>`; `git add <file>`; commit IMMEDIATELY (don't batch). First commit message includes the verbatim startup `pwd`: `WIP(engine-effect-diag): start at $(pwd)`. Before reporting DONE: `git status` MUST be clean. Update `docs/changes/engine-effect-diagnostics-2026-06-11/progress.md` after each step.

---

## THE TASK

### Fix 1 — `effect=` silently drops a non-`${}` value → fire `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error)

**Ruled (user, S182): Option B — reject-with-diagnostic, severity ERROR.** `effect=` is a §7 logic-context block, so the `${...}` form is required (the bare `onclick=load()` §5.2.3 single-expression sugar does NOT extend to `effect=`). Today a bare `effect=load()` compiles clean and the effect is silently tree-shaken — a footgun. Make it a hard error.

Affects BOTH loci (same `${}`-only regex):
- **Opener** (S148 boot effect, §51.0.H Form 3): `compiler/src/ast-builder.js:12985` — `effect\s*=\s*\$\{`.
- **State-child** (§51.0.H Form 1): `compiler/src/engine-statechild-parser.ts:2217` — same regex. Its comment at `:2212` already anticipated this diagnostic ("B17.3 typer can surface a diagnostic") — it was deferred; wire it now.

**Approach (parser sets a flag → SYM fires — the established B15/B18 idiom):**
- **S1** ast-builder.js ~12985: when `effect\s*=` is present in the opener header but the existing `${...}` capture yields null (bare or unbalanced braces), set a flag on the engine-decl node (e.g. `openerEffectMalformed: true`; optionally keep the raw bad slice for the message). Do NOT touch the `${}` capture path.
- **S2** engine-statechild-parser.ts ~2217: same — set `EngineStateChildEntry.effectMalformed: true` when `effect=` is present but not `${...}`.
- **S3** symbol-table.ts: fire `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error). Opener → from the engine-register pass (PASS 10.A `walkRegisterEngines`); state-child → from PASS 11 (`validateEngineStateChildrenAndRules`, which already consumes `EngineStateChildEntry`). Message points at the fix, parameterized by locus, e.g. *"engine `<X>` opener `effect=` must be a `${...}` logic block (§51.0.H Form 3); got a bare value. Wrap it: `effect=${ ... }`."* (state-child variant cross-refs Form 1).
- **S4** §34 + SPEC: add the `E-ENGINE-EFFECT-NOT-INTERPOLATED` catalog row in `compiler/SPEC.md` §34 (beside the other `E-ENGINE-EFFECT-*`, ~line 16895; update the early mirror ~3094 + the §34 prologue count if tracked). Add a normative clause at §51.0.B / §51.0.H: `effect=` (opener Form 3 AND state-child Form 1) REQUIRES `${...}`; a bare value is `E-ENGINE-EFFECT-NOT-INTERPOLATED`. Per pa.md Rule 4 the §34 row + SPEC clause land in the SAME change as the code.

New code name `E-ENGINE-EFFECT-NOT-INTERPOLATED` confirmed absent from the corpus.

### Fix 2 — `E-ENGINE-VAR-DUPLICATE` + `E-ENGINE-003` double-fire → make mutually exclusive

A duplicate engine var fires BOTH `E-ENGINE-VAR-DUPLICATE` (new §51.0.C, `symbol-table.ts:5426`) AND legacy `E-ENGINE-003` "Duplicate machine name" (`type-system.ts:4981`), because `<engine>` decls are shared into both `nodes` and `machineDecls` (per `a41df176`; every `machineDecls` entry is `kind:"engine-decl"`).

**S5 approach — invariant: exactly one duplicate-code per decl.** `E-ENGINE-VAR-DUPLICATE` is canonical for §51.0 **engine**-keyword decls; `E-ENGINE-003` fires only for legacy `<machine>`-keyword decls. Gate `E-ENGINE-003` (`type-system.ts:4978`) to skip engine-keyword decls.

**Phase-0 survey (do this first, report findings before coding S5):** the discriminator is the source keyword (`<engine>` vs `<machine>`), already detected for `W-DEPRECATED-001` around `ast-builder.js:1146`. Find the flag the engine-decl node carries for the keyword used. ALSO check whether `E-ENGINE-VAR-DUPLICATE` (SYM) already fires for a legacy `<machine>` duplicate — if so, decide which code wins per form so a legacy `<machine>` duplicate ALSO yields exactly one code. Pick the cleanest gating.

---

## TESTS (S6)
New unit tests (place beside existing engine tests, e.g. a new `compiler/tests/unit/engine-effect-not-interpolated.test.js` + extend the dup-fire coverage):
- bare opener `effect=load()` → `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error).
- bare state-child `effect=foo()` → `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error).
- canonical opener `effect=${load()}` + state-child `effect=${foo()}` → NO fire (regression — the boot effect / state-child effect must still emit).
- duplicate engine var → `E-ENGINE-VAR-DUPLICATE` only (NOT also `E-ENGINE-003`).
- duplicate legacy `<machine>` name → `E-ENGINE-003` only (regression — keep the legacy path's single code).
- 0 regressions on the full suite (`bun run test`).

## EMPIRICAL VERIFY (S7 — required; diagnostic-only, so lighter than the full R26 but DO it)
Compile real `.scrml` against the post-fix `compiler/bin/scrml.js`:
1. An engine with bare opener `effect=load()` → NOW reports `E-ENGINE-EFFECT-NOT-INTERPOLATED` (was: silent clean compile).
2. The same with `effect=${load()}` → compiles; the emitted client JS still contains the module-init boot call (`§51.0.H Form 3 opener effect=` block) — confirm the fix did NOT regress the canonical path.
3. Two `<engine for=T>` both auto-declaring the same var → exactly ONE duplicate code.
Report the before/after for each in your final report. DO NOT mark DONE without S7 passing.

## FINAL REPORT
WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED (worktree-absolute) · the S7 empirical before/after · the Phase-0 Fix-2 discriminator finding · maps load-bearing feedback · any deferrals.
