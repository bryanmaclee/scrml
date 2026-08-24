# BRIEF — fire E-MATCH-SCRUTINEE-ARITY on a paren-less multi-scrutinee head

change-id: match-scrutinee-arity-diagnostic-2026-08-24
dispatched: S371-bryan, 2026-08-24, base origin/main @ 25b77946
gap: g-library-mode-multi-scrutinee-match-misparsed-as-single (MED, RE-SCOPED S371)
DONE-PROBE: bun compiler/bin/scrml.js compile <paren-less product-arm match> emits E-MATCH-SCRUTINEE-ARITY, not E-CODEGEN-INVALID-LOGIC

## The symptom (PA-VERIFIED BY EXECUTION on 25b77946 — reproduce it first)

Correct, compiles clean:
    export fn pair(a: int, b: int) -> string {
        return match (a, b) { (1, 2) :> "one-two"  else :> "other" }
    }
  -> emits `_scrml_scrut_1 === 1 && _scrml_scrut_3 === 2`

Paren-less head, product arms — FAILS with a diagnostic that names nothing:
    export fn pair(a: int, b: int) -> string {
        return match a, b { (1, 2) :> "one-two"  else :> "other" }
    }
  -> error [E-CODEGEN-INVALID-LOGIC]: the compiler could not lower this construct
  Compile both with: --mode library

## What is NOT the task

⚑ DO NOT make `match a, b` work. SPEC §18.19 grammar (SPEC.md:14030) is
`match-head ::= expression | '(' expression (',' expression)+ ')'` — the parens ARE the
multi-scrutinee head. A paren-less comma head is NOT a multi-scrutinee match, and the
S369 filed direction ("route a comma-header match to emitMultiScrutineeMatch") would have
widened an ungrammatical form. That framing is RETRACTED. Also: "it parses as a JS comma
expression" carries no weight — scrml is not a JS superset (S368 ruling).

## The task

The arms are product patterns `(1, 2)` under a head of scrutinee-count 1 — an ARITY
MISMATCH. `E-MATCH-SCRUTINEE-ARITY` is the §34 code minted for exactly that condition
(SPEC.md:19743 catalog row; §18.19:14101). Make it fire here, at the typer, where arity
is known.

Direction-of-change: the program is REJECTED before AND after — only the diagnostic code
changes. Not newly-accepting, not newly-rejecting. Keep it that way and PROVE it.

## Locus — PA-LOCATED, VERIFY, report held / refined / wrong

Located by reading, NOT traced. I can name the files; I did not trace execution into them.
- compiler/src/type-system.ts:17414-17460 — the E-MATCH-SCRUTINEE-ARITY check lives inside
  the multi-scrutinee typecheck (header comment at :17414, fire at :17459). A 1-scrutinee
  head never enters this function, which is my hypothesis for why the code is unreachable
  in the paren-less case. VERIFY THIS.
- compiler/src/codegen/emit-control-flow.ts:2013 — carries a comment asserting "the typer
  already reported E-MATCH-SCRUTINEE-ARITY". For this shape that assertion is false.
- compiler/src/ast-builder.js:6018 and :10698 — both carry comments about recognizing a
  product arm "so the typer can fire E-MATCH-SCRUTINEE-ARITY". Read them; they may already
  contain the recognition you need, or may reveal the real gate.

If the hypothesis is wrong, follow the evidence and say so in your report.

## Owed with the fix

1. A §34 row-text amendment (SPEC.md:19743). The row currently scopes itself to "a
   multi-scrutinee `match (e1, …, eN)`"; it must also cover product-pattern arms under a
   paren-less head, and the Resolution sentence should name the forgot-the-parens case
   explicitly. Carry a `provenance:` line per Rule 4b — use
   `provenance: spec:§18.19 SPEC.md:14030 "match-head ::= expression | '(' expression (',' expression)+ ')'"`.
2. A conformance case. E-MATCH-SCRUTINEE-ARITY currently has ZERO
   (`grep -rl E-MATCH-SCRUTINEE-ARITY conformance/` returns nothing) against the standing
   merge-blocker rule that a claimed surface is pinned by a case. Add the codes-half.
3. A merge-blocker unit/integration test, BITE-PROVEN (must fail before your fix).
4. A MEASURED migration: grep the corpus for a paren-less comma match head and report the
   count and files. Assumed-zero is not measured-zero.
5. `bun scripts/corpus-emit-differential.ts` is NOT required (diagnostic-only change), but
   if your fix touches any emit path, run it and report.

## Verification gates (do not report DONE without these)

- Full `bun run test` (chains pretest). Report pass/fail/skip. The known pre-existing
  baseline on this tree is ~53 fails (self-host x3 / self-compilation / session / browser
  tier); report a SET-DIFF against base, not a raw count.
- Both repro files above compile with the NEW diagnostic (paren-less) and still compile
  CLEAN (parens form). The parens form MUST NOT regress.
- Report whether the locus hypothesis HELD, was REFINED, or was WRONG.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, then follow its "Task-Shape Routing" section to
the maps for this task shape (expect error.map.md + domain.map.md).
Map watermark: commit `728bdc92`, updated 2026-08-23.
Base for this dispatch: `25b77946`. The ONLY compiler/src landing since the watermark is
25b77946, and it is a COMMENT-ONLY edit to emit-each.ts (byte-identity of emitted artifacts
proven). So the maps are current for your surface. Treat map content as a
verify-against-source hypothesis anyway. Report whether the maps were load-bearing —
including "not load-bearing", which is a useful answer.

## Crash recovery + discipline

- Commit after each meaningful unit; WIP commits expected. Append to progress.md
  (timestamped: what was just done, what's next, blockers). Your branch + progress.md are
  the ONLY crash anchor.
- NEVER `--no-verify`. Do not override core.hooksPath. If a gate blocks you, report it.
- Do not edit outside your worktree. Absolute worktree-rooted paths only.
