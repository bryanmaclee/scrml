# Phase A1b — Step B17.3: typer diagnostics for `<onTransition>` + `effect=`

**Phase:** A1b sub-step continuation. B17 SHIPPED earlier (E-COMPONENT-ENGINE-SCOPE only); B17.2 lands the parser-extension (`<onTransition>` + `effect=` extracted to `engineMeta.stateChildren[].onTransitionElements[]` + `.effectRaw`); B17.3 lands the typer-pass diagnostics over those annotations.
**Estimate:** 2-4h focused (typer pass extension; new PASS 17 mirroring A5-3 PASS 16 pattern).
**Dispatched:** 2026-05-09 (S74). Preconditions LANDED: B17.2 (parser-extension) at commit `fd70150`; C15 (Wave 4 closer) at `43c8747`.
**Authority chain:** SPEC §51.0.F (rule= contract — direct write enforcement = `<onTransition to=>` placement enforcement) + §51.0.H (`effect=` single-target requirement; E-ENGINE-EFFECT-AMBIGUOUS) + §34 row E-ENGINE-EFFECT-AMBIGUOUS (line 14377). PA Rule 4: SPEC §51.0.H + §51.0.F win over any planning-doc paraphrase.

## Re-scope notice — RATIFIED at S74 dispatch time

**Q1 ratified: STANDARD scope** (4 fire-sites per below).
**Q2 ratified: INCLUDE fire-site #5 as NEW E-ONTRANSITION-NO-TARGET error code** added to §34 catalog.

Net B17.3 scope: **5 fire-sites total.**

Naming: B17.3 sub-step continuation. Matches B17.2 sibling parser work.

## Goal (one paragraph)

Add a NEW PASS 17 to the type-system pipeline (mirroring A5-3 PASS 16 pattern at `compiler/src/symbol-table.ts:5830`) that walks B17.2's annotations on engine-decl AST nodes and fires diagnostics. After B17.3 lands, programs with structurally-invalid `<onTransition>` or `effect=` usage emit compile-time errors; downstream codegen (future C-step) can safely consume B17.2's annotations without spec-violating programs slipping through.

## What's already in place (depth-of-survey signal)

**A5-3 PASS 16 precedent — exactly the pattern B17.3 mirrors:**

`compiler/src/symbol-table.ts:5830-5901` defines PASS 16 (A5-3) with 5 fire-sites + transparent fire-sites. Pattern:
- Walks every engine-decl in the file scope
- For each engine-decl with `engineMeta.stateChildren`, iterates state-children
- For each state-child, checks the new annotations (A5-2 `historyAttr`, `internalRule`, `onTimeoutElements`, `innerEngines`)
- Fires diagnostics via `fireA5Diagnostic` helper (line 5911) using engine-decl's span as fallback
- Does NOT recurse into inner engines (composite marker is `innerEngines.length > 0`; inner engines are A1c codegen's recursive responsibility per A5-3 SURVEY §3.3)

`fireA5Diagnostic` helper signature:
```ts
function fireA5Diagnostic(
  errors: SYMDiagnostic[],
  code: string,
  message: string,
  engineDecl: any,
  filePath: string,
  severity: "error" | "warning" = "error",
): void
```

B17.3 pattern: NEW PASS 17 with `fireB17Diagnostic` helper (same signature shape).

**B17.2 outputs (consumed by B17.3 — assumed shape per B17.2 BRIEF):**
- `engineMeta.stateChildren[].effectRaw: string | null`
- `engineMeta.stateChildren[].onTransitionElements: OnTransitionEntry[]`

`OnTransitionEntry` (per B17.2 BRIEF):
```ts
interface OnTransitionEntry {
  to: string | null;          // variant name, no leading dot
  from: string | null;         // variant name, no leading dot
  once: boolean;               // bare attribute
  ifExprRaw: string | null;    // raw expression text
  bodyRaw: string;
  isColonShorthand: boolean;
  rawOffset: number;
}
```

**Existing variant-validation infrastructure:**
- `compiler/src/symbol-table.ts` PASS 11 (B15) — fires E-ENGINE-RULE-INVALID-VARIANT (§34 line 14248) when `rule=` references variant not in engine's `for=Type`. B17.3 reuses the same code (`E-ENGINE-RULE-INVALID-VARIANT`) for `to=`/`from=` validation.
- A5-3 PASS 16 fire-site #4 — fires E-ENGINE-RULE-INVALID-VARIANT for `<onTimeout to=.X/>` validation. EXACT pattern B17.3 mirrors for `<onTransition to=.X>` and `<onTransition from=.X>`.

**Existing rule-contract enforcement infrastructure:**
- A5-3 PASS 16 fire-site #3 — fires E-ENGINE-INVALID-TRANSITION (§34 line 14376) compile-time when `<onTimeout to=.X/>` does not satisfy the surrounding state-child's `rule=` legality. THIS IS THE FIRST COMPILE-TIME E-ENGINE-INVALID-TRANSITION FIRE-SITE per A5-3 SURVEY §1.3 — spec §51.0.M line 20567 explicitly authorizes static check because the from-state IS this state-child. SAME logic applies to `<onTransition to=.X>` in a FROM-state-child placement: §51.0.F's rule= contract demands `to=.X` is a legal target.

## Scope (in / out)

**IN scope (B17.3 — STANDARD shape per Q1 ratification):**

1. **NEW PASS 17 in `compiler/src/symbol-table.ts`** — mirrors PASS 16 (A5-3) structure. Walks engine-decls in the file scope; for each engine-decl with `engineMeta.stateChildren`, iterates state-children and applies the diagnostic checks below. NEW `fireB17Diagnostic` helper (signature mirrors `fireA5Diagnostic`).

2. **Fire-site #1 — E-ENGINE-EFFECT-AMBIGUOUS** (§34 row 14377; §51.0.H line 20471):
   - Predicate: `entry.effectRaw != null && entry.rule.kind === "multi"`.
   - Message: `"E-ENGINE-EFFECT-AMBIGUOUS: 'effect=' attribute on state-child '<{tag}>' has multi-target rule= ({targets}). Use <onTransition to=...> children instead — effect= requires a single-target rule (§51.0.H)."`
   - Severity: error.

3. **Fire-site #2 — E-ENGINE-RULE-INVALID-VARIANT for `<onTransition to=.X>`** (existing §34 row 14248):
   - Predicate: for each `onTransitionEntry`, if `entry.to != null` AND `entry.to NOT IN engineMeta.variants`, fire.
   - Reuse existing E-ENGINE-RULE-INVALID-VARIANT code (mirror A5-3 PASS 16 fire-site #4 pattern).

4. **Fire-site #3 — E-ENGINE-RULE-INVALID-VARIANT for `<onTransition from=.X>`** (existing §34 row 14248):
   - Predicate: for each `onTransitionEntry`, if `entry.from != null` AND `entry.from NOT IN engineMeta.variants`, fire.
   - Same code as fire-site #2; same pattern.

5. **Fire-site #4 — E-ENGINE-INVALID-TRANSITION (compile-time) for FROM-state-child `<onTransition to=.X>` placement** (existing §34 row 14376; §51.0.F rule= contract):
   - Predicate: for each `onTransitionEntry`, if `entry.to != null` AND `entry.to IS valid variant of for=Type` (fire-site #2 didn't fire) AND the enclosing state-child's `rule=` does NOT include `entry.to` as a legal target, fire.
   - Wildcard rule (`rule=*`) accepts any target — never fires.
   - Multi-target rule (`rule=(.A | .B)`) — `entry.to` must be in `[.A, .B]`.
   - Single-target rule (`rule=.A`) — `entry.to` must be `.A`.
   - Absent rule (terminal state, no `rule=`) — fires for ANY `entry.to` (terminal states have no outgoing transitions).
   - Mirrors A5-3 PASS 16 fire-site #3 (`<onTimeout to=.X>`) exact pattern.
   - Message: `"E-ENGINE-INVALID-TRANSITION: <onTransition to=.{to}> in state-child '<{fromTag}>' is not a legal transition target — rule= contract is {ruleRepr}. Either add .{to} to rule=, or place this <onTransition from=.{fromTag}> in the <{to}> state-child instead (§51.0.F)."`
   - Severity: error.

6. **Fire-site #5 — NEW E-ONTRANSITION-NO-TARGET** (Q2 RATIFIED):
   - Predicate: `entry.to == null && entry.from == null`. The handler has no trigger.
   - Message: `"E-ONTRANSITION-NO-TARGET: <onTransition> in state-child '<{tag}>' has neither to= nor from= attribute. The handler has no trigger. Add to=.Variant (outgoing) or from=.Variant (incoming) (§51.0.H)."`
   - Severity: error.
   - **Add to §34 catalog** as NEW row (next free in the E-ENGINE-* / E-ONTRANSITION-* family — survey to pick exact slot). Mirror existing row format.
   - **Edit `compiler/SPEC.md` §34** to add the new row. (This dispatch's only SPEC.md touch.)

**OUT of scope (deferred):**

- **Codegen for `effect=` + `<onTransition>` firing** — separate C-step; consumes B17.3-validated annotations.
- **Structural-placement check** for `<onTransition>` outside engine state-child (E-STRUCTURAL-ELEMENT-MISPLACED) — gated on markup walker that tokenizes `<onTransition>` everywhere. Same precondition as A5-3 SURVEY §10 deferred fire-site #5 (gated on the same parser infrastructure).
- **Inside-component-body / inside-`<match>`-arms cases** — B17.2 doesn't parse these contexts; B17.3 doesn't see them either. Future B17.4 / parser-extension territory.
- **`<onTransition>` BODY type-checking** — if `bodyRaw` contains arbitrary effect statements, the typer would need to walkable-AST-parse the body to type-check expressions inside. Body-rendering wide step territory; out of B17.3.
- **`if=expr` type-checking** — if `ifExprRaw` is a legal scrml expression, general expression-typer machinery should already handle. Survey: confirm whether the typer sees the expression at all in B17.2's raw-text form.
- **Cross-file engine `<onTransition>` validation** — when an engine is imported and mounted via `<EngineName/>` use-site (C15 territory), the `<onTransition>` annotations on the EXPORTING file's state-children remain valid as-is. No new B17.3 work for cross-file.

## Spec verification (pa.md Rule 4)

Spec sections to read (verbatim) BEFORE writing PASS 17:

- **§51.0.H** (lines ~20457-20507) — `effect=` (Form 1, single-target only) + `<onTransition>` (Form 2, multi-target/conditional). E-ENGINE-EFFECT-AMBIGUOUS per line 20471.
- **§51.0.F** (lines ~20379-20427) — rule= contract; direct write enforcement; `<onTransition to=.X>` placement is structurally a "direct write to .X from this from-state" so the rule= contract applies.
- **§34** rows:
  - E-ENGINE-EFFECT-AMBIGUOUS (line ~14377) — fire-site #1 NEW use.
  - E-ENGINE-RULE-INVALID-VARIANT (line ~14248) — fire-sites #2 + #3 reuse.
  - E-ENGINE-INVALID-TRANSITION (line ~14376) — fire-site #4 compile-time NEW use (mirroring A5-3 PASS 16 fire-site #3).
- **A5-3 SURVEY §10** at `docs/changes/phase-a7-step-a5-3-typer-walker/SURVEY.md` — for "deferred-on-infrastructure" reasoning shape (model B17.3's structural-placement deferral after this).

If derived planning docs contradict spec, **SPEC WINS.** Quote in SURVEY.

## Dispatch protocol

S67 worktree-as-scratch / file-delta landing.

## Authorized decisions

- **File locus:** EXTEND `compiler/src/symbol-table.ts` with NEW PASS 17 + `fireB17Diagnostic` helper. Mirror A5-3 PASS 16 placement (after PASS 16 in the file). NO new files.
- **Test file:** `compiler/tests/unit/b17-3-typer-diagnostics-ontransition-effect.test.js`.
- **Naming convention:** PASS 17 (next available number after PASS 16 = A5-3). `fireB17Diagnostic` (mirrors `fireA5Diagnostic`).
- **Pass placement in pipeline:** AFTER PASS 16 (A5-3) — both consume A5-2 + B17.2 parser annotations; B17.3 has no dependency on PASS 16's outputs but ordering keeps the typer family contiguous.

## Sibling-dispatch awareness

**B17.2 is the precondition.** B17.3 cannot dispatch until B17.2 lands (B17.3 consumes B17.2's `engineMeta.stateChildren[].onTransitionElements[]` + `.effectRaw` annotations).

If B17.3 is dispatched after both B17.2 + C15 land, it operates standalone. If dispatched WHILE C15 is still in flight, file-disjoint check: C15 is `compiler/src/codegen/*` territory; B17.3 is `compiler/src/symbol-table.ts` only. Disjoint.

The downstream C-step that consumes B17.3's validated annotations + emits codegen (`effect=` + `<onTransition>` firing) is a future dispatch — likely C13b or new C-step. NOT in B17.3's scope.

## Anti-patterns reading

`scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` — even though this is typer-pass work, the test fixtures must be canonical scrml. State-machine validation has heavy XState `actions` array / Redux middleware error-handling training-data bias. The scrml shape is `<onTransition to=.Variant once if=expr>${...}</>` element child of state-child, NOT `actions: [send('GROW'), assign({...})]` array config in a state machine factory.

## File-modification inventory expected

| File | Reason |
|---|---|
| `compiler/src/symbol-table.ts` | NEW PASS 17 + `fireB17Diagnostic` helper |
| `compiler/SPEC.md` | NEW §34 row for E-ONTRANSITION-NO-TARGET (fire-site #5; Q2 ratified) |
| `compiler/SPEC-INDEX.md` | Update §34 row note if needed |
| `compiler/tests/unit/b17-3-typer-diagnostics-ontransition-effect.test.js` (NEW) | Unit tests covering all 5 fire-sites |
| `docs/changes/phase-a1b-step-b17-3-typer-diagnostics-ontransition-effect/{progress,SURVEY}.md` | Crash-recovery + survey output (REQUIRED) |

**Negative inventory (MUST NOT touch):**
- `compiler/src/engine-statechild-parser.ts` — that's B17.2's territory; parser is done.
- `compiler/src/codegen/*` — downstream C-step territory.
- (UPDATED: `compiler/SPEC.md` IS in scope for the NEW §34 row only — fire-site #5. No other spec edits.)

## Definition of Done

- All 5 §scope IN fire-sites shipped per Q1+Q2 ratification.
- 0 regressions vs baseline (10,486 / 65 / 1 / 0 — post-C15 close).
- Spec re-verified against §51.0.H + §51.0.F + §34 rows directly per pa.md Rule 4.
- A5-3 PASS 16 NOT regressed (existing fire-sites still work).
- B15 PASS 11 canonical-rule variant validation NOT regressed.
- B17 PASS 13 E-COMPONENT-ENGINE-SCOPE NOT regressed.
- B17.2 parser annotations consumed correctly (no false-positive fires; no missed fires on intentional negative test cases).
- SURVEY.md documents:
  - §34 slot chosen for E-ONTRANSITION-NO-TARGET (next free in family).
  - `if=expr` type-check status (does general typer machinery already see it? Or do we need to surface as separate concern?).
  - Verdict shape: SHIP / REFINEMENT / SCOPE-CHANGE / BLOCKER.
- Final report names downstream codegen C-step prerequisites (which validated annotations the C-step can trust as type-checked).

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: **<ABSOLUTE-WORKTREE-PATH-PROVIDED-BY-HARNESS>**

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. Output MUST equal the worktree path above. Save as WORKTREE_ROOT.
2. Run `git rev-parse --show-toplevel` via Bash. Output MUST equal WORKTREE_ROOT.
3. Run `git status --short` via Bash. Confirm tree is clean.
4. Run `bun install` via Bash. Worktrees do NOT inherit `node_modules`.
5. Run `bun run pretest` via Bash.
6. Run `bun run test` (chained) via Bash. Confirm 10,486 / 65 / 1 / 0 baseline (post-C15).

If ANY check fails: DO NOT proceed. Report the mismatch and exit.

## Path discipline (enforce on EVERY Read/Write/Edit call)

- For Read: paths under WORKTREE_ROOT are safe.
- For Write/Edit: **ALWAYS use ABSOLUTE paths under WORKTREE_ROOT.** Do NOT use relative paths or paths starting with the main repo root. Do NOT touch parser files (B17.2's territory) or codegen files (downstream C-step territory).

If you find yourself about to write to a path starting with the main repo root, STOP. Re-derive from WORKTREE_ROOT.

## Crash-recovery protocol

Commit after each meaningful change. Update `$WORKTREE_ROOT/docs/changes/phase-a1b-step-b17-3-typer-diagnostics-ontransition-effect/progress.md` after each step.

## Final report format

- WORKTREE_PATH (absolute)
- FINAL_SHA (your branch tip)
- FILES_TOUCHED (list — should be EXACTLY `compiler/src/symbol-table.ts`, the test file, and the two dispatch-dir docs)
- VERDICT (SHIP / REFINEMENT / SCOPE-CHANGE / BLOCKER)
- TESTS at end: pass / skip / todo / fail
- DEFERRED-ITEMS: anything punted to follow-on / PA-decision
- SURVEY summary (one paragraph) — three decisions documented
- Downstream C-step HANDOFF: which annotations are guaranteed type-checked after B17.3 ships
