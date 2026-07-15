# BRIEF — ss71 conformance authoring: match / exhaustiveness §18 (12 codes)

**Dispatched by:** sPA ss71 · **Branch:** `spa/ss71` (worktree `../scrml-spa-ss71`, base `origin/main` 85efaf77) · **Agent:** scrml-js-codegen-engineer (non-isolated, CWD = this worktree)

## Task
Author conformance-corpus cases for the 12 `match`/exhaustiveness §18 diagnostic codes below. One code per
item; each item = a POS case (input that triggers the code) + a NEG case (clean sibling; code goes in
`notCodes`). Pure conformance-corpus authoring — NO compiler changes.

## Where / setup (DO NOT deviate)
- Work ONLY in `/home/bryan-maclee/scrmlMaster/scrml-spa-ss71`. `node_modules` symlinked; harness green 445/445 baseline.
- Write ONLY NEW case directories under `conformance/cases/`. Put all ss71 cases under a single new category
  dir `conformance/cases/match-codes/` (subdir per case). Do NOT edit or delete any existing case, and do NOT
  touch anything outside `conformance/cases/match-codes/`.
- Run NO git commands (no add/commit/checkout/push/stash). The sPA does all git ops. You only write files + run the harness.

## Method (conformance authoring — impl#1 is the oracle)
1. For each code: `grep -rn 'E-...' compiler/src` at the line the item names → read the trigger condition.
2. Read the relevant `compiler/SPEC.md` §18 subsection.
3. Author the `.scrml` from **impl#1 ACTUAL behavior** (what the compiler really emits), sanity-checked vs SPEC.
4. If impl#1 diverges from SPEC (code doesn't fire / fires a DIFFERENT code / different message): author the case
   to match impl#1's ACTUAL behavior (the corpus pins impl#1), and **RECORD the divergence** in your final
   report. Do NOT "fix" the compiler and do NOT decide the SPEC question — escalate it in the report.
5. Mirror the syntax of existing GREEN cases in `conformance/cases/match-block/` and `match-identifier/`
   (declaration forms, `${...}` logic blocks, `.Variant :> body` arms, `match subj { ... }`). scrml has NO
   null/undefined — absence is `not`.

## Case schema (mirror exactly)
Each case = `conformance/cases/match-codes/<slug>/` with:
- `case.scrml` — the input program.
- `expected.json`:
```json
{
  "id": "match-codes-<slug>",
  "description": "§18.x — what the case proves + why (regression-guard framing).",
  "language-version": "1.0",
  "source-test": "compiler/tests/unit/type-system.test.js",
  "spec": "§18.x",
  "rationale": "§18.x normative sentence(s) justifying the expectation.",
  "expect": { "codes": ["E-..."], "notCodes": [] }
}
```
POS: target code in `codes`. NEG: `codes: []`, target code (+ near-neighbors) in `notCodes`.
Suggested slugs: `<code-tail>-pos` / `<code-tail>-neg` (e.g. `e-match-012-missing-not-arm-pos`).

## The 12 codes (one code per item; POS + NEG each)
1. **E-MATCH-012** — a `T | not` union match missing the `not` arm (`type-system.ts:16954`). POS: match over `T | not` w/o a `not` arm → E-MATCH-012. NEG: exhaustive `not` arm → silent.
2. **E-MATCH-ARM-MARKUP-IN-VALUE** — markup in a value-form match arm (`type-system.ts:16420`). POS + NEG (value expr in a value-form arm → silent).
3. **E-MATCH-BLOCK-IN-LIFT** — a block match arm inside a `lift` context (`validators/post-ce-invariant.ts:107`, "A block ..."). POS + NEG.
4. **E-MATCH-EFFECT-FORBIDDEN** — an effect inside a value-context match arm (`symbol-table.ts:12971`). POS + NEG (pure arm → silent).
5. **E-MATCH-ON-REQUIRED** — a `match` needing an `on=` scrutinee (`symbol-table.ts:12398`). POS + NEG (`on=` present → silent).
6. **E-MATCH-ONTRANSITION-FORBIDDEN** — `<onTransition>` forbidden inside a match arm (`symbol-table.ts:12989`). POS + NEG.
7. **E-SYNTAX-010** — an `else` arm not last (§18.6; `type-system.ts:16490`) OR `null`/etc. as a value → use `not` (§42; `codegen/rewrite.ts:1067`). POS + NEG (else-last / `not` → silent). Grep to confirm which trigger fires in the match context; author for that trigger.
8. **E-SYNTAX-011** — match arm guard-clause misuse (`type-system.ts:16481`). POS + NEG (valid guard → silent).
9. **E-TYPE-006** — a non-exhaustive multi-scrutinee match (`type-system.ts:16785`). POS (missing combination) + NEG (exhaustive).
10. **E-TYPE-024** — cannot match on a struct-typed subject (`type-system.ts:16535`). POS + NEG (enum-typed subject → silent).
11. **E-TYPE-025** — cannot match on a non-matchable subject (`type-system.ts:16546`). POS + NEG.
12. **E-TYPE-026** — a match used where a logic interpolation is required ("Wrap the match in a logic interpolation …", `type-system.ts:9197 / 16785 area`). POS + NEG.

## Definition of done
- All 12 codes pinned (POS reject + clean NEG each; ~24 new case dirs under `conformance/cases/match-codes/`).
- `bun conformance/run.ts` GREEN — expect **445 → ~469** (report the exact final N/N).
- Final report lists: every created case dir, the final harness count, and EVERY impl#1-vs-SPEC divergence
  found (code that didn't fire / fired differently / SPEC mismatch) — escalate, do not fix.
