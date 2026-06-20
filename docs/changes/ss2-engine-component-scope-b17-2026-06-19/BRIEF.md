# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is the CWD that `pwd` reports at startup.

## Startup verification (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Else STOP (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git rev-parse --abbrev-ref HEAD` + `--short HEAD`; `git status --short` clean.
4. `bun install`. 5. `bun run pretest`. Baseline via `bun run test`.

If ANY check fails: STOP and report.

## Path discipline
- ALL edits via Bash (`perl -0pi`/`python3`/heredoc/`cp`) on WORKTREE_ROOT-absolute paths
  WITH the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write (S126). Echo path
  before each write; verify with `git diff` after.
- NEVER main-rooted paths; NEVER `cd` into main. Use `git -C`/`bun --cwd`/absolute paths.

## Commit discipline
- Commit per unit; create+update
  `docs/changes/ss2-engine-component-scope-b17-2026-06-19/progress.md` per step.
- Coupled code+test = ONE commit. `git status` clean before DONE. NEVER `--no-verify`.

---

# TASK — ss2 item 5: B17 engine-component-scope deferred cases — SURVEY, ACTIVATE the now-unblockable, PARK the rest

## Context (LOW severity · tier HIGH · expect a PARTIAL completion)

`compiler/tests/unit/engine-component-scope-b17.test.js` has a `describe("B17 — DEFERRED
end-to-end cases (preconditions not met)")` block (~lines 259-324) with **8 `test.skip`
placeholders** whose bodies are `expect(true).toBe(true)` stubs. Each carries a BLOCKER
comment describing what was missing when it was written. **Several blocker comments are
STALE** — the machinery they say is missing has since LANDED. This is an R26/R4 survey:
re-verify each blocker against CURRENT source, ACTIVATE the cases that are now reachable
(replace the stub with a REAL assertion + wire any small missing validation), and PARK the
cases that still need a from-scratch subsystem.

**This item is EXPECTED to land partial.** The 3 component-body cases are gated on a
from-scratch component-body markup parser, which is OUT of sPA scope (a from-scratch
subsystem — the sPA parks + escalates these to the PA). Do NOT build that parser.

## Phase 0 — SURVEY each of the 8 skips (REQUIRED before any edit)

For each `test.skip` in the block, write the documented reproducer as a real `.scrml`
source, compile/parse it (BS → ast-builder → runSYM, or `compileScrml`), and record: does
the precondition NOW hold? does the expected diagnostic fire? Classify each as
**ACTIVATE** (reachable now) or **PARK** (still blocked). The sPA's starting hypothesis
(VERIFY each — do not trust it):

**PARK (still blocked — need a component-body markup parser; component-def stores body as
`component-def.raw: string`, not walkable AST):**
- (1) `end-to-end: engine-decl in component-def.defChildren via parser`
- (2) `end-to-end: engine-decl inside the raw markup body of a component-def`
- (3) `engine mount tag <EngineName/> inside a component body`

**ACTIVATE-candidate (blocker comment is STALE — the machinery landed):**
- (4) `effect= on multi-target rule= → E-ENGINE-EFFECT-AMBIGUOUS` — comment says §51.0.F
  state-children "have no implementation"; FALSE now — `engine-statechild-parser.ts` parses
  §51.0.F `sc.rule`/`sc.bodyRaw`, and `E-ENGINE-EFFECT-AMBIGUOUS` is in the §34 catalog
  (~line 17126). Verify the diagnostic actually fires for `<Small rule=(.Big|.Fire) effect=${...}>`.
- (5) `<onTransition to=.Variant> placement validation` — comment says `<onTransition>` "is
  not tokenized"; FALSE now — `validateEngineA5Extensions` validates `<onTransition>` (the
  `sc.onTransitionElements` fire-sites). Verify.
- (6) `<onTransition> direction attributes (to=/from=) — required + variant validation` —
  same stale blocker as (5); `E-ONTRANSITION-NO-TARGET` is in the catalog (~17129). Verify.
- (7) `<onTransition> inside a <match> arm → E-MATCH-ONTRANSITION-FORBIDDEN`
- (8) `effect= inside a <match> arm → E-MATCH-EFFECT-FORBIDDEN`
  — both gated on block-form `<match for=Type on=expr>` parsing. VERIFY whether block-form
  `<match>` is parsed now (it may be — check `E-MATCH-ONTRANSITION-FORBIDDEN` /
  `E-MATCH-EFFECT-FORBIDDEN` exist + whether the parser produces block-match nodes). If
  parsed → ACTIVATE; if not → PARK with the precise current blocker.

## Phase 1 — ACTIVATE the reachable cases

For each case the survey classifies ACTIVATE:
- Replace the `test.skip("[deferred] ...", () => { ...expect(true).toBe(true) })` stub with
  a REAL `test(...)` that compiles the documented reproducer and asserts the expected
  diagnostic fires (use the file's existing helper for SYM error codes; check the right
  stream per `feedback_diagnostic_stream_partition` — `E-` codes in errors, `W-`/`I-` via a
  cross-stream helper).
- If the validation EXISTS and the case already passes → just activate the test (no source
  change).
- If the validation is MISSING but small + clearly specced (e.g. a placement check whose
  sibling already exists in `validateEngineA5Extensions` / the match-arm validator), WIRE
  it minimally, mirroring the nearest existing fire-site. Cite the §34 catalog row + the
  SPEC section. Do NOT invent new diagnostic codes — these all already exist in §34.
- Keep each activated test + its (optional) source change in ONE commit.

## Phase 2 — PARK the component-body cases (1,2,3) + any still-blocked match case

- Leave them `test.skip` BUT refresh the blocker comment to the CURRENT, accurate blocker
  (delete the stale wording). State precisely what is missing: the component-body markup
  parser (component-def `raw: string` → walkable AST), and that activating cases 1-3
  requires that subsystem.
- In your DELIVERABLE, write a crisp PARK escalation for the sPA→PA: the 3 cases, the exact
  precondition (component-body markup parser pass), why it is a from-scratch subsystem
  beyond sPA scope, and a pointer to `ast-builder.js` line ~9149-9151 (the engine-decl
  must-be-markup-child enforcement) + the `component-def.raw` storage.

## VERIFICATION (R26)
1. The activated tests pass; the parked tests remain skipped with accurate comments.
2. **Full `bun run test`** (incl. browser) → 0 regressions vs the baseline you record at
   startup. Any new source validation must not over-fire on existing fixtures — if a
   fixture newly errors, verify it is a genuine violation (report it) vs a false-fire (fix).
3. Report the survey table (8 cases: ACTIVATE/PARK + evidence), the diagnostics each
   activated case fires, and any source wiring you added.

## DELIVERABLE
The Phase-0 survey table (per-case classification + the reproducer + observed result),
files changed (line ranges), the PARK escalation text for cases 1-3 (+ any parked match
case), full `bun run test` summary, every re-baseline old→new, HEAD SHA + branch. Commit to
your branch; `git status` clean. The sPA lands your changed files onto `spa/ss2`
(cherry-pick for symbol-table.ts which carries sibling ss2 changes).

Do NOT push. Do NOT touch main. Do NOT build the component-body markup parser (PARK + report).
