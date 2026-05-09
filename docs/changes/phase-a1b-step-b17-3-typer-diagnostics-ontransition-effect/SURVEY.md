# SURVEY — B17.3 typer diagnostics for `<onTransition>` + `effect=`

**Dispatched:** 2026-05-09 (S74)
**Worktree:** `.claude/worktrees/agent-ae1dd109aeeb33565`
**Authority:** SPEC §51.0.H (lines 20536-20585), §51.0.F (lines 20379+), §34 (lines 14002-14470).
PA Rule 4: spec wins.

## Three documented decisions

### Decision 1 — `§34 slot for E-ONTRANSITION-NO-TARGET`

**Survey of existing §34 rows (engine + onTransition family):**

| Line | Row |
|---|---|
| 14453 | `E-ENGINE-INVALID-TRANSITION` (§51.0.F, §51.0.G) |
| 14454 | `E-ENGINE-EFFECT-AMBIGUOUS` (§51.0.H) |
| 14455 | `E-ENGINE-VAR-DUPLICATE` (§51.0.C) |
| 14463 | `E-ENGINE-MOUNT-NOT-ENGINE` (§51.0.D, §21.8) |
| 14464 | `E-ENGINE-STATE-CHILD-MISSING` (§51.0.B, §51.0.F) |
| 14465 | `E-ENGINE-STATE-CHILD-INVALID-VARIANT` (§51.0.B) |
| 14466 | `E-ENGINE-INITIAL-INVALID-VARIANT` (§51.0.E) |
| 14467 | `E-ENGINE-RULE-INVALID-VARIANT` (§51.0.F) |
| 14468 | `E-ENGINE-RULE-LEGACY-SYNTAX` (§51.0.F) |
| 14469 | `E-HISTORY-NO-INNER-ENGINE` (§51.0.N, §51.0.Q) |
| 14470 | `E-INTERNAL-RULE-NOT-COMPOSITE` (§51.0.O, §51.0.Q) |

**Decision.** Insert NEW row `E-ONTRANSITION-NO-TARGET` **immediately after `E-ENGINE-EFFECT-AMBIGUOUS` (line 14454)**, becoming the new line 14455. Rationale:

- Both codes are gated by §51.0.H (`<onTransition>` + `effect=` semantics).
- Adjacent placement keeps the §51.0.H family contiguous before the §51.0.C/.D/.B/.E/.F engine-shape codes.
- Mirrors the row format of `E-ENGINE-EFFECT-AMBIGUOUS` (single spec ref → one-line description → severity column).
- Also append to §34 catalog summary table at line ~25498 (mirrors `E-MATCH-ONTRANSITION-FORBIDDEN` pattern).

The S74 catalog-addition note follows S68/S69 precedent (e.g., `(Catalog addition S74 — A1b B17.3.)`).

### Decision 2 — `if=expr` type-check status

**Survey.** B17.2 captures `OnTransitionEntry.ifExprRaw: string | null` as RAW TEXT (kept verbatim from source per B17.2 SURVEY decisions 1 + 3). The text retains paren-wrapping `(@gameOver == false)` or `${...}` wrapping or bare-expression form.

**Engine bodies are RAW TEXT in the parser today** (per `symbol-table.ts:5891-5894` PASS 16 comment block: *"Engine bodies are RAW TEXT (parser limitation per primer §13.7 B14 specifics)."*). The general expression-typer machinery does NOT see the raw text inside `engineMeta.stateChildren[].onTransitionElements[].ifExprRaw` — there is no walkable AST for the body region.

**Decision.** B17.3 is **NOT responsible for `if=expr` type-checking**. It would require a sub-pipeline to invoke the expression-typer over the captured raw text, plus span tracking to surface diagnostics at the right offset. Both are out-of-scope per BRIEF §scope-OUT bullet 5 ("`if=expr` type-checking — survey: confirm whether the typer sees the expression at all in B17.2's raw-text form"). DEFERRED to a future C-step (likely the same C-step that walks `<onTransition>` body for codegen).

B17.3 STILL surfaces structural `ifExprRaw` fire-sites if any (none in the BRIEF's 5 fire-sites — the fire-site list does not include any `if=`-shape diagnostics, and §51.0.H does not name a shape error code for `if=`). Effect: B17.3 leaves `ifExprRaw` untouched — passes through verbatim to downstream codegen.

### Decision 3 — Span fallback (coarse vs tight)

**Survey.** B17.2's `OnTransitionEntry.rawOffset` is **substring offset relative to the enclosing state-child's `bodyRaw`** — NOT an absolute file offset, and NOT a span object. Same for `EngineStateChildEntry.rawOffset` (relative to engine-decl's `rulesRaw`).

To reconstruct an absolute span requires:
1. The engine-decl's `span.start` (available).
2. The header-line-end → `rulesRaw`-start offset (per ast-builder; B15 SURVEY notes this is unrecorded in the public record today).
3. The state-child opener's offset within `rulesRaw` (`rawOffset` field on `EngineStateChildEntry`).
4. The `<onTransition>` opener's offset within state-child `bodyRaw` (`rawOffset` field on `OnTransitionEntry`).

Steps 2 + 3 + 4 sum to a probable absolute offset, but step 2 requires reading parser internals not in the public record.

**Decision.** B17.3 mirrors A5-3 PASS 16's coarse-anchor approach — uses **engine-decl's `span` as the diagnostic anchor**. Identical pattern to `fireA5Diagnostic` at `symbol-table.ts:5974-5986`. Span tightening is a forward-compat enhancement (parser surfaces tightened spans → swap span source in `fireB17Diagnostic` without touching call-sites). Same precedent A5-3 set; B17.3 inherits.

The diagnostic MESSAGE includes the state-child tag and (for fire-site #4) the `to=` variant name, giving the developer enough textual context to locate the offending `<onTransition>` even with coarse-anchor span.

## Spec verification (PA Rule 4)

Quoted SPEC §51.0.H normative form (line 20548-20550):

> `effect=` is a logic-context expression that runs when the transition fires. Legal ONLY
> when `rule=` is single-target. Combining `effect=` with a multi-target `rule=` is
> ambiguous (which target triggers it?) — `E-ENGINE-EFFECT-AMBIGUOUS` (§34).

Quoted SPEC §51.0.H normative table (line 20563-20570):

| Attribute | Meaning |
|---|---|
| `to=.Variant` | Target — fires when leaving this from-state TOWARD `.Variant`. |
| `from=.Variant` | Source — placed in TARGET state-child to fire on incoming transitions FROM `.Variant`. Inverts directionality. |
| `once` | Bare attribute — handler runs at most ONCE for the engine's lifetime, then is dropped. |
| `if=expr` | Conditional gating — handler fires only when `expr` evaluates true at transition time. |

Quoted SPEC §51.0.F (line ~20379+): rule= contract. Direct write to `.Variant` is statically rejected when from-state is known and `.Variant` is not in the rule= target set — fires `E-ENGINE-INVALID-TRANSITION`. The `<onTransition to=.X>` placed in a FROM-state-child is structurally a "direct write to .X from this from-state" → same rule= contract applies.

The parser-level table (line 20563-20570) lists `to/from/once/if=` as the FOUR built-in attributes. The presence-of-direction requirement (`to` OR `from` MUST appear) is implicit in the table — both columns describe what the handler responds to; an `<onTransition>` with neither has no trigger. **`E-ONTRANSITION-NO-TARGET` is the explicit spec-aligned diagnostic for that nonsensical shape.**

## Pre-commit verdict shape

If all 5 fire-sites land + 0 regressions vs baseline (10308 pass / 60 skip / 1 todo / 0 fail) + new tests cover positive (no-fire) and negative (fire) cases for each fire-site: **SHIP**.

If a parser annotation field is found to differ in shape from the BRIEF's typing (e.g., `effectRaw` is undefined where expected): **REFINEMENT** with parser-extension flag (NOT B17.3's territory; would request a B17.2.1 patch).

## Final verdict: SHIP

All 5 fire-sites landed. 26 new tests pass. Final test counts: **10,512 pass / 65 skip / 1 todo / 0 fail** (post-main-merge baseline 10,486 + 26 new B17.3 tests = 10,512). 0 regressions vs baseline. 0 path-discipline leaks. All four upstream invariants preserved (A5-3 PASS 16, B15 PASS 11, B17 PASS 13, B17.2 parser annotations consumed correctly with no false-positive / missed-fire cases per the 26 tests).

**Worktree ancestry note:** worktree was forked from `532966f` (S73 wrap), which predates B17.2 + C15 (preconditions named in BRIEF). Resolved by merging main (`43c8747`) into the worktree mid-encoding (commit `121dc17`). One conflict in SPEC-INDEX (concurrent S74 catalog-addition lines) cleanly resolved by combining both in one row. Stash markers in main's SPEC.md (lines 13698-13702 + 13754-13758) are pre-existing in main and NOT created by this dispatch — left untouched.

## Sequencing observation (downstream codegen handoff)

After B17.3 ships, downstream C-step (codegen for `effect=` + `<onTransition>` firing) can trust:

- **`stateChild.effectRaw` is non-null only on single-target rules** (E-ENGINE-EFFECT-AMBIGUOUS gated).
- **Every `<onTransition>` entry has at least one of {to, from} populated** (E-ONTRANSITION-NO-TARGET gated).
- **`<onTransition to=.X>` `.X` is a valid variant of the engine's `for=Type`** (E-ENGINE-RULE-INVALID-VARIANT gated).
- **`<onTransition from=.X>` `.X` is a valid variant of the engine's `for=Type`** (E-ENGINE-RULE-INVALID-VARIANT gated).
- **`<onTransition to=.X>` placed in a FROM-state-child is permitted by the surrounding `rule=` contract** (E-ENGINE-INVALID-TRANSITION gated).

Codegen still must:
- Type-check `ifExprRaw` (DEFERRED per Decision 2 above).
- Validate `<onTransition>` body for nested effect statements.
- Correlate `from=.X` placements against the FROM-state-child's `rule=` to reach this state-child (cross-state-child consistency check; not in B17.3 scope).
