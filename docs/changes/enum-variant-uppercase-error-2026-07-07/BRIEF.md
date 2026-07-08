# BRIEF — Error on lowercase enum variant / type names (§14.4) instead of silent-drop (MED, S245)

CHANGE-ID: `enum-variant-uppercase-error-2026-07-07`
BASELINE: current main. USER RULING (2026-07-07): keep the §14.4 uppercase rule, but the compiler must **ERROR**
on a violation, not silently drop it.
DISPATCHED-BY: scrml PA (S245). AGENT: scrml-js-codegen-engineer · isolation:worktree · background.
NOTE: commits are HELD (user) — build + report; the PA reviews + lands. Worktree crash-recovery commits are fine.

## The bug
SPEC §14.4 (SPEC.md:7644-7645): "Enum variant names SHALL begin with an uppercase letter" + "Enum type names SHALL
begin with an uppercase letter." **Currently UNENFORCED.** A lowercase variant is **silently dropped** — the shared
enum emitter (`emit-client.ts emitEnumVariantObjects`) omits non-uppercase variants, so `type Kind:enum = { rule,
disp, land }` produces NO runtime rep with NO diagnostic → a consumer importing `Kind` gets `undefined`. A silent
miscompile of a spec-violating construct (surfaced by the export-enum-library dispatch on flogence's `delta-log`).

## The fix — fire a diagnostic at the enum PARSE/TYPE stage
1. **Name a new error code.** Suggest **`E-ENUM-VARIANT-CASE`** (variant name not uppercase). Cover enum TYPE names
   too (§14.4:7645) — either the same code or a sibling `E-ENUM-TYPE-CASE` (your call; name per §34 conventions).
   Per Rule 4 / named-codes-land-with-impl: cite the code in §14.4 (the rule) + add the §34 catalog row(s) in THIS
   change.
2. **Fire it upstream of codegen.** The variant-name check belongs in `parseEnumBody` (`type-system.ts:1693` — it
   parses the enum body string into variants). For each variant name, if the first char is not `[A-Z]`, push the
   diagnostic (point the span/message at the offending variant). The enum TYPE-name check fires where the type-decl
   name is validated (find it — the `type Foo:enum` decl parse). A violating enum then fails compilation loudly
   instead of reaching codegen and silently vanishing.
3. **Message** — actionable: name the offending variant + the rule + the fix. E.g. `E-ENUM-VARIANT-CASE: enum
   variant \`rule\` must begin with an uppercase letter (§14.4). Rename it \`Rule\`.` (Mirror the surrounding
   diagnostic style.)

## ACCEPTANCE (all must hold)
- `type Kind:enum = { rule, disp }` → fires `E-ENUM-VARIANT-CASE` naming `rule` (was: silent no-rep). A lowercase
  ENUM TYPE name (`type color:enum = {...}`) → fires the type-name diagnostic.
- Controls: `type Color:enum = { Red, Green(shade:int) }` compiles clean; a payload variant `Green(shade:int)` is
  fine (the FIELD `shade` is lowercase — that is correct, do NOT flag payload field names, only VARIANT names).
- Real case: flogence `delta-log.scrml` now fails LOUDLY on `Kind` (the correct outcome — it prompts the
  uppercase migration) rather than silently dropping it.
- Regression: all existing uppercase-variant enums across the corpus/stdlib still compile (they already conform);
  verify zero new failures.
- Regression tests (lowercase variant errors · lowercase type name errors · payload field lowercase is FINE ·
  uppercase clean) + a conformance case (codes-half: `E-ENUM-VARIANT-CASE` fires). Full suite `bun run test` → 0
  fail (document pre-existing env-floor).

## SPEC — read + amend (Rule 4)
Read §14.4 (SPEC.md:7630-7665) + §34 (the code catalog). Amend §14.4 to cite the new code on the two SHALL bullets;
add the §34 catalog row(s). **NOTE:** a sibling session is also editing `compiler/SPEC.md` (§38.13) — keep your
edits confined to §14.4 + your §34 row(s) so the PA can reconcile the two SPEC.md changes per-section at land.

## SCOPE FENCE
Touch ONLY the enum variant/type-name parse-validate site (`type-system.ts` `parseEnumBody` + the type-decl-name
validation) + `compiler/SPEC.md` §14.4/§34 + tests/conformance. **Do NOT touch** `emit-client.ts`
`emitEnumVariantObjects` (its non-uppercase drop becomes unreachable dead-code once the error fires upstream — a
sibling thread reuses that emitter; leave it), `emit-library.ts`, `channel-watches.ts`, the string-blind scanner
files, or `runtime-template.js`. Do NOT edit `docs/known-gaps.md` (PA marks it at landing).

## STARTUP + PATH DISCIPLINE (worktree)
`pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90). `git
rev-parse --show-toplevel`==WORKTREE_ROOT; `git status --short` clean; FF to current main; `bun install`; `bun run
pretest`. Apply ALL edits via Bash on worktree-absolute paths (NOT Edit/Write). Never `cd` into main. First commit
message includes verbatim `pwd`. Commit incrementally; keep progress.md.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (Task-Shape Routing — a diagnostic-adding compiler-source fix + a §34/error.map
touch). Report the Maps line.

## REPORT
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` · the code name(s) you chose + why · the fire site(s) · the R26
evidence (delta-log now errors on `Kind`; an uppercase enum still clean) · the payload-field-lowercase-is-fine
evidence · the corpus-regression (zero new failures) · the §14.4/§34 amendment · the conformance case · the Maps line.
