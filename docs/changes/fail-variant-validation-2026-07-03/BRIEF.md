# BRIEF — §19.3.3 fail-variant validation + mint E-ERROR-009 (S236)

**Gap:** `g-fail-variant-unvalidated` (docs/known-gaps.md §S236). **Ruling (user S236): FIX + mint a dedicated code.**

## The gap (PA Rule-4/R26 workup — CONFIRMED)
SPEC §19.3.3 (`compiler/SPEC.md:12878`), normative + verbatim:
> "`fail` SHALL produce a value of the error enum type declared in the function's `!` signature. The variant specified in the `fail` statement SHALL be a valid variant of that error enum type. A variant that does not belong to the declared error type SHALL be a compile error (E-TYPE-001)."

impl#1 emits NOTHING for an invalid fail-variant. The typer `fail` handler (`compiler/src/type-system.ts:8603-8620`) fires ONLY `E-ERROR-001` (fail-in-non-`!`-function). No variant-membership check exists (grep-confirmed: `E-TYPE-001` is wired only for §14.12 lifecycle + §8 positional-init — it is NOT the right code to reuse here).

Four silent shapes (all verified silent by sPA ss58 escalation #1):
```scrml
enum MyError { NotFound(id: string), Timeout }
function f()! MyError {
  fail MyError.Nonexistent(x)     // (1) undeclared variant of the DECLARED enum  → E-ERROR-009
  fail OtherError.Whatever        // (2) FOREIGN enum entirely                    → E-ERROR-009
  fail MyError.Timeout("oops")    // (3) payload on a NULLARY variant (arity)     → see below
  fail "just a string"            // (4) non-enum target                          → E-ERROR-009 (or existing type error)
}
```

## Task
1. **Phase 0 — R26 reproduce-FIRST.** Before any fix, construct the 4 shapes above and CONFIRM impl#1 is currently silent on each (compile → observe no diagnostic). Report the baseline. (If any already fires, adjust scope — don't fix a ghost.)
2. **Mint `E-ERROR-009`** = "`fail` names a variant that is not a valid variant of the declared error enum type." (`E-ERROR-001..008` are all taken — 008 is the reserved-field code; 009 is free, PA-verified.) Message shape:
   `E-ERROR-009: 'fail' names variant '{Variant}' which is not a valid variant of the declared error type '{ErrorType}' for function '{name}'. Valid variants: {list}.`
3. **Implement the check** in the typer `fail` handler (`type-system.ts` ~8603-8620, right after the E-ERROR-001 non-`!` gate passes and the declared error type is in hand). Cases (1) undeclared-variant and (2) foreign-enum are the §19.3.3-direct cases → `E-ERROR-009`. Case (4) non-enum target → `E-ERROR-009` (or the existing type-error path if one already catches "fail target is not an error enum" — reproduce + decide, report which). Case (3) payload-arity: check whether enum-variant construction ALREADY arity-checks (it may fire via the enum-construction path); if it does, leave it; if it's ALSO silent, note it — a minimal arity check is in-scope but secondary. Report the disposition of (3)/(4) explicitly.
4. **SPEC amendment** (author it; PA verifies at landing): §19.3.3 change `(E-TYPE-001)` → `(E-ERROR-009)`; add the §34 catalog row `| E-ERROR-009 | §19.3.3 | fail variant not a valid variant of the declared error enum | Error |` (add to BOTH §34 catalog copies — there are two, ~L13826 and ~L17617 region; grep `E-ERROR-008` to find them). Regenerate SPEC-INDEX if the line count shifts (`bun scripts/regen-spec-index.ts`).
5. **Re-author the reject conformance cases** the sPA deliberately did NOT enshrine (it authored only the conformant E-ERROR-001 path). Add under `conformance/cases/error/`: `fail-variant-undeclared-neg`, `fail-variant-foreign-enum-neg`, `fail-non-enum-neg` — each a `case.scrml` + `expected.json` asserting `E-ERROR-009` (mirror the existing `error/fail-*` case shape; capture from YOUR fixed impl then SPEC-sanity-check). Keep the existing `error/fail-*` cases GREEN. Run `bun conformance/run.ts` — report the new total (should be prior + 3).

## Adversarial (S215) — must-not-break
- A VALID `fail MyError.NotFound(id)` still compiles clean (no false E-ERROR-009).
- `E-ERROR-001` (fail-in-non-`!`) still fires unchanged.
- The default-`Error` enum path (`fail Error.Generic("x")` in a bare `!` fn, §19.4.2) still works.
- `fail` inside if/for/match arms (§19.3.3 last bullet) still validates the variant.
- Full pre-commit suite green (the hook gates on green — do NOT `--no-verify`).

## Mechanics
- `isolation: 'worktree'`, model opus. Commit INCREMENTALLY on your branch (crash-recovery). Verify `git status` shows no leak into the main checkout (S99/S126 path discipline — write ONLY inside your worktree).
- Report: baseline (Phase 0), the E-ERROR-009 fire sites, the SPEC delta, the conformance delta, adversarial results, FINAL_SHA. PA re-integrates via S67 file-delta at completion.
