# BRIEF (re-provision) — ss69 conformance authoring: type/state soundness §14/§42/§53/§54

**Dispatched by:** sPA ss69 (re-provision — first worktree was destroyed mid-run; its findings are baked in below).
**Branch:** `spa/ss69` (worktree `../scrml-spa-ss69`, base **current main `7d5fda26`**) · **Agent:** scrml-js-codegen-engineer, non-isolated, CWD = this worktree.

## Task
Author conformance cases for the **13 REACHABLE** type/state-soundness codes below. One code per item;
POS (triggers code) + clean NEG (code in `notCodes`) each → 26 case dirs under
`conformance/cases/type-state-codes/`. Pure conformance authoring — NO compiler changes. The first run
already verified every recipe below fires against main's compiler; your job is to reconstruct + confirm green.

## Setup (DO NOT deviate)
- Work ONLY in `/home/bryan-maclee/scrmlMaster/scrml-spa-ss69`. `node_modules` symlinked. cd there FIRST every Bash call.
- STEP 0: `bun conformance/run.ts` → confirm baseline **459/459** (NOT 445 — base drifted).
- Write ONLY new dirs under `conformance/cases/type-state-codes/`. Do NOT edit/delete existing cases or touch anything else.
- Run NO git commands. The sPA does all git. You only author + run the harness.

## Method
For each code: `grep -rn '<CODE>' compiler/src` at the named line, read the trigger + SPEC subsection, author
POS + NEG from impl#1 ACTUAL behavior, mirror existing green cases in `conformance/cases/enum/`,
`refinement/`, `block-grammar/`. scrml has NO null/undefined — absence is `not`, the absence CHECK is `is not`.
Case schema = `<slug>/case.scrml` + `<slug>/expected.json` with `{id, description, language-version:"1.0",
source-test:"compiler/tests/unit/type-system.test.js", spec, rationale, expect:{codes, notCodes}}`.

## The 13 codes to author (all verified reachable)
1. **E-TYPE-004** (`type-system.ts:13021`) — field access on a struct lacking the field. **Simple recipe:** a plain struct-typed local — `let p: Point = {x:1,y:2}` then `p.bogus` (NO sql fixture needed). NEG: access an existing field.
2. **E-TYPE-022** (`symbol-table.ts:7447`) — engine named-binding to an undeclared state-child field (`<Done bogus=b …>`). NEG: bind a declared field (`rows=r`).
3. **E-TYPE-041** (`type-system.ts:10054`) — assignment type mismatch: `let x: string = not`. NEG: `let x: string | not = not`.
4. **E-TYPE-045** (`type-system.ts:18932`) — prefix `not` as boolean negation: `if (not @ready) {…}`. NEG: absence form `@x is not`.
5. **E-TYPE-062** (`type-system.ts:13332`) — `is` LHS not enum-typed: `let name = "Alice"  if (name is .Admin){…}`. NEG: enum-typed LHS.
6. **E-TYPE-081** (`type-system.ts:9237`) — `partial match` in a render/lift context. NEG: a full (non-partial) `match`.
7. **E-TYPE-ANY-FORBIDDEN** (`type-system.ts:5463`) — a declared `any` type: `type T:struct = {a: any, b: string}`. NEG: `a: asIs`.
8. **E-STRUCT-FUNCTION-FIELD** (`type-system.ts:4109`) — struct field typed `fn()`: `type T:struct = {cb: fn(), label: string}`. NEG: `cb: string`.
9. **E-STATE-UNDECLARED** (`type-system.ts:7471`) — write to an undeclared state cell: `function f(){ @undecl = 42 }`. NEG: declare `<count> = 0` first.
10. **E-STATE-TRANSITION-ILLEGAL** (`type-system.ts:7606`) — call an undeclared transition on a substate instance (`sub.wrongName()` where sub: Draft). NEG: a declared transition (`sub.validate()`). Uses canonical `< Draft body(string)>` substate syntax.
11. **E-STATE-TERMINAL-MUTATION** (`type-system.ts:7692`) — write a field of a TERMINAL state (`done.body = "x"` where done: Validated, terminal). NEG: write a non-terminal state's field.
12. **E-TYPE-LIFECYCLE-ON-ENGINE-CELL** (`type-system.ts:4013`) — a lifecycle-annotated cell that collides with an engine cell (`<phase>: (Idle to Active) = .Idle` alongside `<engine for=Phase …>`). NEG: plain engine, drop the lifecycle decl.
13. **E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED** (`type-system.ts:25687`) — variant-specific field access without transition; decl MUST be **top-level** (V5-strict): `<phase>: (.Draft to .Published) = Article.Draft` then `if (@phase is .Draft){ @phase.publishedAt }`. NEG: discriminate but no variant-field access.

## PARK — do NOT author (first run proved unreachable-via-source; genuine impl#1 architecture facts)
- **E-TYPE-042** — preempted by **E-EQ-002** (`ast-builder.js:4701` rewrites `== not`→`is not` before codegen; the codegen E-TYPE-042 check never sees it).
- **E-TYPE-071** — preempted by the **S39 expression preprocessor** (`render name(…)`→`__scrml_render_name__` before the codegen rewrite pass; regex never matches).
- **E-STATE-COMPLETE** — **parser-gated** (inline state-literal field-assignment syntax `< Product> name=n </>` not parser-supported yet; walker never sees an unassigned-field instance).

## Incidental co-fires — keep OUT of `notCodes` (present in both POS+NEG or POS-only, expected)
- `W-PROGRAM-SPA-INFERRED` — incidental on every SPA-inferred case.
- State-machine cases (10, 11): carry incidental `E-TYPE-UNKNOWN-NAME` + `W-WHITESPACE-001` (canonical `< Draft …>` syntax) — do NOT list them.
- Code 12 POS also fires `E-ENGINE-VAR-DUPLICATE` (name collision is the trigger vehicle) — keep out of `notCodes`.

## Definition of done
- 13 codes pinned (POS + NEG each; 26 case dirs). `bun conformance/run.ts` GREEN — expect **459 → 485**.
- Report: every created dir (path + POS/NEG + code); the exact final harness line; any recipe that did NOT reproduce (so the sPA can park/escalate).
